const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { PDFDocument } = require("pdf-lib");
const crypto = require('crypto');
const { processImageForLambda, cleanupTempFiles, getFileExtension, validateFileForLambda } = require('./utils/lambdaHelpers');

// Simple in-memory cache for processed files (cleared on server restart)
const fileProcessingCache = new Map();

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Database functions with error handling
let loadStats, trackEvent, logUserActivity, getUserActivityStats, getRecentUserActivities, extractClientInfo;
try {
    const db = require('./database');
    loadStats = db.loadStats;
    trackEvent = db.trackEvent;
    logUserActivity = db.logUserActivity;
    getUserActivityStats = db.getUserActivityStats;
    getRecentUserActivities = db.getRecentUserActivities;
    extractClientInfo = db.extractClientInfo;
    console.log('Database module loaded successfully');
    
    // Test connection asynchronously (non-blocking) with retry logic
    const testConnection = async (retries = 3) => {
        for (let i = 0; i < retries; i++) {
            try {
                await db.connectToDatabase();
                console.log('MongoDB connection test completed successfully');
                return;
            } catch (error) {
                console.warn(`MongoDB connection test failed (attempt ${i + 1}/${retries}):`, error.message);
                if (i === retries - 1) {
                    console.warn('MongoDB connection test failed after all retries (non-critical)');
                } else {
                    // Wait before retry
                    await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
                }
            }
        }
    };
    
    // Run connection test after a delay to avoid blocking startup
    setTimeout(testConnection, 1000);
} catch (error) {
    console.warn('Database module not available, using fallbacks:', error.message);
    loadStats = async () => ({
        totalVisits: 0,
        totalConversions: 0,
        totalCombines: 0,
        totalPdfToWord: 0,
        totalPdfToImages: 0
    });
    trackEvent = async () => {};
    logUserActivity = async () => {};
    getUserActivityStats = async () => [];
    getRecentUserActivities = async () => [];
    extractClientInfo = () => ({ ip: '127.0.0.1', userAgent: 'Unknown' });
}

// Initialize Express app
const app = express();

// Configure multer for serverless (use /tmp directory with better cleanup)
const upload = multer({ 
    dest: '/tmp/uploads',
    limits: {
        fileSize: 30 * 1024 * 1024, // Reduced to 30MB for Lambda stability
        files: 8 // Reduced max files for Lambda
    }
});

// Ensure upload directory exists
const uploadDir = '/tmp/uploads';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Enable CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    next();
});

// Basic middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Lambda debug endpoint
app.get('/api/debug', (req, res) => {
    const debugInfo = {
        environment: process.env.NODE_ENV,
        tmpDir: '/tmp',
        tmpExists: fs.existsSync('/tmp'),
        tmpContents: fs.existsSync('/tmp') ? fs.readdirSync('/tmp').slice(0, 10) : [],
        uploadsDir: '/tmp/uploads',
        uploadsExists: fs.existsSync('/tmp/uploads'),
        memory: process.memoryUsage(),
        cwd: process.cwd(),
        platform: process.platform,
        version: process.version
    };
    res.json(debugInfo);
});

// API endpoint to get stats
app.get('/api/stats', async (req, res) => {
    let client;
    try {
        const { client: mongoClient, db } = await getMongoConnection();
        client = mongoClient;
        
        const collection = db.collection('stats');
        let stats = await collection.findOne({ _id: 'global' });
        
        if (!stats) {
            // Create initial stats if they don't exist
            stats = {
                totalVisits: 0,
                totalConversions: 0,
                totalCombines: 0,
                totalPdfToWord: 0,
                totalPdfToImages: 0,
                dailyStats: {},
                lastUpdated: new Date().toISOString()
            };
        }
        
        await client.close();
        res.json(stats);
    } catch (error) {
        if (client) {
            try { await client.close(); } catch (e) { console.error('Close error:', e); }
        }
        console.error('Error fetching stats:', error);
        // Return default stats if database is unavailable
        res.json({
            totalVisits: 0,
            totalConversions: 0,
            totalCombines: 0,
            totalPdfToWord: 0,
            totalPdfToImages: 0,
            dailyStats: {},
            lastUpdated: new Date().toISOString(),
            error: 'Database unavailable'
        });
    }
});

// Middleware to track page visits with detailed logging
app.use(async (req, res, next) => {
    // Track visits to main pages and API endpoints
    const shouldTrack = req.path === '/' || 
                       req.path === '/convert' || 
                       req.path === '/combine' || 
                       req.path === '/pdf-to-word' ||
                       req.path === '/pdf-to-images' ||
                       req.path.endsWith('.html');
    
    if (shouldTrack) {
        // Don't await tracking to avoid blocking the response
        (async () => {
            let client;
            try {
                const { client: mongoClient, db } = await getMongoConnection();
                client = mongoClient;
                
                const collection = db.collection('stats');
                let stats = await collection.findOne({ _id: 'global' });
                
                if (!stats) {
                    stats = {
                        _id: 'global',
                        totalVisits: 1,
                        totalConversions: 0,
                        totalCombines: 0,
                        totalPdfToWord: 0,
                        totalPdfToImages: 0,
                        dailyStats: {},
                        lastUpdated: new Date().toISOString()
                    };
                    await collection.insertOne(stats);
                } else {
                    stats.totalVisits = (stats.totalVisits || 0) + 1;
                    stats.lastUpdated = new Date().toISOString();
                    await collection.replaceOne({ _id: 'global' }, stats);
                }
                
                await client.close();
                console.log(`Visit tracked: ${req.path}`);
            } catch (error) {
                if (client) {
                    try { await client.close(); } catch (e) { console.error('Close error:', e); }
                }
                console.error('Error tracking visit (non-critical):', error.message);
            }
        })();
    }
    next();
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        env: process.env.NODE_ENV || 'development',
        mongodb: process.env.MONGODB_URI ? 'configured' : 'not configured'
    });
});

// Debug endpoint to check environment variables (remove after testing)
app.get('/api/debug-env', (req, res) => {
    res.json({
        hasMongoUri: !!process.env.MONGODB_URI,
        nodeEnv: process.env.NODE_ENV,
        mongoUriLength: process.env.MONGODB_URI ? process.env.MONGODB_URI.length : 0,
        mongoUriPrefix: process.env.MONGODB_URI ? process.env.MONGODB_URI.substring(0, 20) + '...' : 'none'
    });
});

// Test MongoDB connection endpoint
app.get('/api/test-db', async (req, res) => {
    try {
        const db = require('./database');
        await db.connectToDatabase();
        const stats = await db.loadStats();
        res.json({ 
            success: true, 
            message: 'Database connection successful',
            stats: stats 
        });
    } catch (error) {
        res.json({ 
            success: false, 
            error: error.message,
            stack: error.stack 
        });
    }
});

// Simplified MongoDB helper for serverless
async function getMongoConnection() {
    const { MongoClient } = require('mongodb');
    const uri = process.env.MONGODB_URI;
    
    if (!uri) {
        throw new Error('MongoDB URI not found');
    }
    
    const client = new MongoClient(uri, {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000
    });
    
    await client.connect();
    return { client, db: client.db('convertfile') };
}

// Test tracking endpoint
app.get('/api/test-tracking', async (req, res) => {
    let client;
    try {
        const { client: mongoClient, db } = await getMongoConnection();
        client = mongoClient;
        
        const collection = db.collection('stats');
        let stats = await collection.findOne({ _id: 'global' });
        
        if (!stats) {
            stats = {
                _id: 'global',
                totalVisits: 1,
                totalConversions: 0,
                totalCombines: 0,
                totalPdfToWord: 0,
                totalPdfToImages: 0,
                dailyStats: {},
                lastUpdated: new Date().toISOString()
            };
            await collection.insertOne(stats);
        } else {
            stats.totalVisits = (stats.totalVisits || 0) + 1;
            stats.lastUpdated = new Date().toISOString();
            await collection.replaceOne({ _id: 'global' }, stats);
        }
        
        await client.close();
        
        res.json({ 
            success: true, 
            message: 'Stats incremented successfully!',
            stats: stats 
        });
    } catch (error) {
        if (client) {
            try { await client.close(); } catch (e) { console.error('Close error:', e); }
        }
        console.error('Tracking test error:', error);
        res.json({ 
            success: false, 
            error: error.message
        });
    }
});

// Supported formats
const supportedFormats = ["jpg", "png", "tiff", "bmp", "webp", "avif", "svg", "pdf", "txt"];
const supportedMimetypes = [
    "image/jpg", "image/jpeg", "image/png", "image/tiff", "image/heic", "image/heif",
    "image/bmp", "image/webp", "image/avif", "image/svg+xml"
];

// File conversion endpoint
app.post("/convert", upload.array("files"), async (req, res) => {
    let cleanupFiles = [];
    
    try {
        const clientInfo = extractClientInfo(req);
        const format = req.body.output_format?.toLowerCase();
        
        if (!format || !supportedFormats.includes(format)) {
            // Log failed conversion attempt
            await logUserActivity({
                action: 'conversion_failed',
                reason: 'invalid_format',
                requestedFormat: format,
                ...clientInfo
            });
            return res.status(400).json({ error: `Invalid format. Supported: ${supportedFormats.join(", ")}` });
        }
        
        if (!req.files || req.files.length === 0) {
            // Log failed conversion attempt
            await logUserActivity({
                action: 'conversion_failed',
                reason: 'no_files',
                ...clientInfo
            });
            return res.status(400).json({ error: "No files uploaded." });
        }

        // Track conversion with MongoDB
        try {
            await trackEvent('conversion');
            
            // Log detailed conversion activity
            const totalFileSize = req.files.reduce((sum, file) => sum + file.size, 0);
            await logUserActivity({
                action: 'file_conversion',
                outputFormat: format,
                fileCount: req.files.length,
                fileSize: totalFileSize,
                fileTypes: req.files.map(f => f.mimetype).filter((v, i, arr) => arr.indexOf(v) === i),
                ...clientInfo
            });
        } catch (trackError) {
            console.error('Error tracking conversion (non-critical):', trackError);
        }
        
        // Add uploaded files to cleanup list
        cleanupFiles.push(...req.files.map(f => f.path));
        
        if (req.files.length === 1) {
            // Single file conversion - return the file directly
            const file = req.files[0];
            const inputExt = path.extname(file.originalname).toLowerCase().slice(1);
            const outputPath = path.join('/tmp', `converted_${Date.now()}.${format}`);
            cleanupFiles.push(outputPath);
            
            console.log(`Converting ${file.originalname} (${inputExt}) to ${format}`);
            
            // Convert the file
            await convertSingleFile(file, inputExt, format, outputPath);
            
            // Send the converted file
            const originalName = path.parse(file.originalname).name;
            const downloadName = `${originalName}.${format}`;
            
            res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
            res.setHeader('Content-Type', format === 'pdf' ? 'application/pdf' : `image/${format}`);
            
            const fileStream = fs.createReadStream(outputPath);
            fileStream.pipe(res);
            
            fileStream.on('end', () => {
                // Clean up files after sending
                cleanupFiles.forEach(filePath => {
                    try {
                        if (fs.existsSync(filePath)) {
                            fs.unlinkSync(filePath);
                        }
                    } catch (cleanupError) {
                        console.error('Cleanup error:', cleanupError);
                    }
                });
            });
        } else {
            // Multiple files conversion - create a ZIP
            const { createCompatibleZip } = require('./utils/compatibleZip');
            const zipPath = path.join('/tmp', `converted_files_${Date.now()}.zip`);
            cleanupFiles.push(zipPath);
            
            let convertedFiles = [];
            
            // Process each file
            for (let i = 0; i < req.files.length; i++) {
                const file = req.files[i];
                const inputExt = path.extname(file.originalname).toLowerCase().slice(1);
                const outputPath = path.join('/tmp', `converted_${i}_${Date.now()}.${format}`);
                cleanupFiles.push(outputPath);
                
                console.log(`Converting file ${i + 1}/${req.files.length}: ${file.originalname} (${inputExt}) to ${format}`);
                
                try {
                    // Convert the file
                    await convertSingleFile(file, inputExt, format, outputPath);
                    
                    // Read converted file and add to collection
                    const convertedBuffer = fs.readFileSync(outputPath);
                    const originalName = path.parse(file.originalname).name;
                    const convertedFileName = `${originalName}.${format}`;
                    
                    convertedFiles.push({
                        buffer: convertedBuffer,
                        name: convertedFileName
                    });
                    
                } catch (fileError) {
                    console.error(`Error converting ${file.originalname}:`, fileError);
                    // Add error file to collection
                    convertedFiles.push({
                        buffer: Buffer.from(`Error converting ${file.originalname}: ${fileError.message}`, 'utf8'),
                        name: `ERROR_${file.originalname}.txt`
                    });
                }
            }
            
            // Create ZIP file with converted files
            try {
                await createCompatibleZip({
                    outputPath: zipPath,
                    files: convertedFiles
                });
                
                // Send the ZIP file
                const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
                const downloadName = `converted_files_${timestamp}.zip`;
                
                res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
                res.setHeader('Content-Type', 'application/zip');
                
                // Check if running in Lambda environment
                const isLambda = process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT;
                
                if (isLambda) {
                    // For Lambda, read file as buffer and send directly
                    const zipBuffer = fs.readFileSync(zipPath);
                    res.end(zipBuffer);
                } else {
                    // For regular servers, use streaming
                    const fileStream = fs.createReadStream(zipPath);
                    fileStream.pipe(res);
                }
                
                // Clean up files after sending
                setTimeout(() => {
                    cleanupFiles.forEach(filePath => {
                        try {
                            if (fs.existsSync(filePath)) {
                                fs.unlinkSync(filePath);
                            }
                        } catch (cleanupError) {
                            console.error('Cleanup error:', cleanupError);
                        }
                    });
                });
                
            } catch (zipError) {
                console.error('ZIP creation failed:', zipError);
                throw new Error(`Failed to create ZIP file: ${zipError.message}`);
            }
        }

        console.log(`Conversion completed: ${req.files.length} file(s) to ${format} from ${clientInfo.ip}`);

    } catch (error) {
        console.error("Conversion error:", error);
        
        // Clean up on error
        cleanupFiles.forEach(filePath => {
            try {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            } catch (cleanupError) {
                console.error('Cleanup error:', cleanupError);
            }
        });
        
        // Log conversion error
        try {
            const clientInfo = extractClientInfo(req);
            await logUserActivity({
                action: 'conversion_error',
                error: error.message,
                ...clientInfo
            });
        } catch (logError) {
            console.error('Error logging conversion error:', logError);
        }
        
        res.status(500).json({ error: error.message || "Conversion failed" });
    }
});

// Helper function to generate file hash for caching
function generateFileHash(filePath, fileSize) {
    const hash = crypto.createHash('md5');
    hash.update(filePath + fileSize.toString());
    return hash.digest('hex');
}

// Helper function to get cached processed image or process and cache it
async function getCachedOrProcessImage(file, fileExt) {
    const fileHash = generateFileHash(file.path, file.size);
    
    // Check cache first
    if (fileProcessingCache.has(fileHash)) {
        console.log(`Using cached result for ${file.originalname}`);
        return fileProcessingCache.get(fileHash);
    }
    
    let result;
    try {
        if (fileExt === '.heic' || fileExt === '.heif') {
            console.log(`Converting HEIC file: ${file.originalname}`);
            const heicConvert = require('heic-convert');
            const heicFileBuffer = fs.readFileSync(file.path);
            const imageBuffer = await heicConvert({
                buffer: heicFileBuffer,
                format: 'JPEG',
                quality: 0.8
            });
            result = {
                buffer: imageBuffer,
                isJpeg: true
            };
            console.log(`Successfully converted HEIC file: ${file.originalname}`);
        } else {
            const sharpInstance = sharp(file.path);
            
            if (['.jpg', '.jpeg'].includes(fileExt)) {
                const imageBuffer = await sharpInstance
                    .rotate() // Auto-orient based on EXIF data
                    .jpeg({ quality: 85, progressive: true })
                    .toBuffer();
                result = {
                    buffer: imageBuffer,
                    isJpeg: true
                };
            } else {
                const imageBuffer = await sharpInstance
                    .rotate() // Auto-orient based on EXIF data
                    .png({ compressionLevel: 6, adaptiveFiltering: false })
                    .toBuffer();
                result = {
                    buffer: imageBuffer,
                    isJpeg: false
                };
            }
        }
        
        // Cache the result (with size limit to prevent memory issues)
        if (fileProcessingCache.size < 100) { // Limit cache to 100 items
            fileProcessingCache.set(fileHash, result);
        }
        
        return result;
    } catch (error) {
        console.error(`Error processing image file ${file.originalname}:`, error);
        throw error; // Re-throw to be handled by caller
    }
}

// Helper function to convert a single file
async function convertSingleFile(file, inputExt, format, outputPath) {
    // Handle image format conversions using Sharp
    if (['jpg', 'jpeg', 'png', 'tiff', 'bmp', 'webp', 'avif'].includes(format)) {
        let sharpInstance = sharp(file.path);
        
        // Handle HEIC files
        if (inputExt === 'heic' || inputExt === 'heif') {
            const heicConvert = require('heic-convert');
            const heicBuffer = fs.readFileSync(file.path);
            const convertedBuffer = await heicConvert({
                buffer: heicBuffer,
                format: 'PNG'
            });
            sharpInstance = sharp(convertedBuffer);
        }
        
        // Apply auto-rotation for all images to handle EXIF orientation
        sharpInstance = sharpInstance.rotate();
        
        // Apply format-specific conversion
        switch (format) {
            case 'jpg':
            case 'jpeg':
                await sharpInstance.jpeg({ quality: 90 }).toFile(outputPath);
                break;
            case 'png':
                await sharpInstance.png().toFile(outputPath);
                break;
            case 'tiff':
                await sharpInstance.tiff().toFile(outputPath);
                break;
            case 'webp':
                await sharpInstance.webp({ quality: 90 }).toFile(outputPath);
                break;
            case 'avif':
                await sharpInstance.avif({ quality: 90 }).toFile(outputPath);
                break;
            case 'bmp':
                // Use PNG format for BMP as Sharp doesn't support BMP output directly
                await sharpInstance.png().toFile(outputPath);
                break;
            default:
                throw new Error(`Unsupported output format: ${format}`);
        }
    } 
    // Handle document format conversions
    else if (['pdf', 'txt'].includes(format)) {
        if (inputExt === 'docx') {
            const docx = require('docx');
            const PizZip = require('pizzip');
            
            try {
                // Read the DOCX file
                const docxBuffer = fs.readFileSync(file.path);
                
                if (format === 'txt') {
                    // Convert DOCX to plain text
                    const zip = new PizZip(docxBuffer);
                    const doc = new docx.Document(zip);
                    
                    // Extract text content
                    let textContent = '';
                    
                    // Simple text extraction from DOCX
                    const docData = zip.file("word/document.xml").asText();
                    const textRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g;
                    let match;
                    
                    while ((match = textRegex.exec(docData)) !== null) {
                        textContent += match[1] + ' ';
                    }
                    
                    // Clean up text
                    textContent = textContent.replace(/\s+/g, ' ').trim();
                    
                    // Write to output file
                    fs.writeFileSync(outputPath, textContent, 'utf8');
                    
                } else if (format === 'pdf') {
                    // Convert DOCX to PDF using pdf-lib
                    // For Lambda environment, we'll create a simple PDF with text content
                    const zip = new PizZip(docxBuffer);
                    
                    // Extract text content first
                    let textContent = '';
                    const docData = zip.file("word/document.xml").asText();
                    const textRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g;
                    let match;
                    
                    while ((match = textRegex.exec(docData)) !== null) {
                        textContent += match[1] + ' ';
                    }
                    
                    textContent = textContent.replace(/\s+/g, ' ').trim();
                    
                    // Create PDF with the text content
                    const pdfDoc = await PDFDocument.create();
                    const page = pdfDoc.addPage([612, 792]); // Letter size
                    
                    // Split text into lines that fit the page width
                    const maxLineLength = 80;
                    const lines = [];
                    const words = textContent.split(' ');
                    let currentLine = '';
                    
                    for (const word of words) {
                        if ((currentLine + word).length > maxLineLength) {
                            if (currentLine) {
                                lines.push(currentLine.trim());
                                currentLine = word + ' ';
                            } else {
                                lines.push(word);
                            }
                        } else {
                            currentLine += word + ' ';
                        }
                    }
                    if (currentLine.trim()) {
                        lines.push(currentLine.trim());
                    }
                    
                    // Add text to PDF
                    let yPosition = 750;
                    const lineHeight = 14;
                    
                    for (const line of lines) {
                        if (yPosition < 50) break; // Stop if we reach bottom of page
                        page.drawText(line, {
                            x: 50,
                            y: yPosition,
                            size: 12
                        });
                        yPosition -= lineHeight;
                    }
                    
                    const pdfBytes = await pdfDoc.save();
                    fs.writeFileSync(outputPath, pdfBytes);
                }
                
            } catch (docxError) {
                console.error('DOCX conversion error:', docxError);
                throw new Error(`Failed to convert DOCX file: ${docxError.message}`);
            }
        } else {
            throw new Error(`Cannot convert ${inputExt} to ${format}. Only DOCX to PDF/TXT is supported.`);
        }
    } else {
        throw new Error(`Unsupported conversion: ${inputExt} to ${format}`);
    }
}

// File combine endpoint
app.post("/combine", upload.array("files"), async (req, res) => {
    let cleanupFiles = [];
    
    try {
        const clientInfo = extractClientInfo(req);
        
        if (!req.files || req.files.length === 0) {
            // Log failed combine attempt
            await logUserActivity({
                action: 'combine_failed',
                reason: 'no_files',
                ...clientInfo
            });
            return res.status(400).json({ error: "No files uploaded." });
        }

        // Track combine with MongoDB
        try {
            await trackEvent('combine');
            
            // Log detailed combine activity
            const totalFileSize = req.files.reduce((sum, file) => sum + file.size, 0);
            await logUserActivity({
                action: 'file_combine',
                fileCount: req.files.length,
                fileSize: totalFileSize,
                fileTypes: req.files.map(f => f.mimetype).filter((v, i, arr) => arr.indexOf(v) === i),
                ...clientInfo
            });
        } catch (trackError) {
            console.error('Error tracking combine (non-critical):', trackError);
        }
        
        // Add uploaded files to cleanup list
        cleanupFiles.push(...req.files.map(f => f.path));
        
        // Check total file size to prevent issues with large files (reduced for Lambda)
        const totalSize = req.files.reduce((sum, file) => sum + file.size, 0);
        const maxTotalSize = 50 * 1024 * 1024; // Reduced to 50MB for Lambda stability
        
        if (totalSize > maxTotalSize) {
            throw new Error(`Total file size (${(totalSize / 1024 / 1024).toFixed(1)}MB) exceeds the limit of 50MB. Please reduce the number or size of files.`);
        }
        
        // Log Lambda environment info for debugging
        console.log('Lambda environment check:', {
            totalFiles: req.files.length,
            totalSizeMB: (totalSize / 1024 / 1024).toFixed(1),
            tmpDirExists: fs.existsSync('/tmp'),
            freeSpace: fs.existsSync('/tmp') ? 'checking...' : 'N/A'
        });
        
        // Create a new PDF document
        const pdfDoc = await PDFDocument.create();
        let processedFiles = 0;
        
        // Helper function to process individual files with better Lambda support
        const processFile = async (file, index) => {
            const fileExt = path.extname(file.originalname).toLowerCase();
            
            console.log(`Processing file ${index + 1}/${req.files.length}: ${file.originalname} (${(file.size / 1024).toFixed(1)}KB)`);
            
            try {
                if (fileExt === '.pdf') {
                    // For PDFs, return the loaded document and pages for later merging
                    if (!fs.existsSync(file.path)) {
                        console.error(`PDF file not found: ${file.path}`);
                        return null;
                    }
                    
                    const existingPdfBytes = fs.readFileSync(file.path);
                    if (existingPdfBytes.length === 0) {
                        console.error(`Empty PDF file: ${file.originalname}`);
                        return null;
                    }
                    
                    const existingPdf = await PDFDocument.load(existingPdfBytes);
                    const pageIndices = existingPdf.getPageIndices();
                    
                    console.log(`PDF loaded: ${file.originalname} with ${pageIndices.length} pages`);
                    
                    return {
                        type: 'pdf',
                        document: existingPdf,
                        pageIndices: pageIndices,
                        index
                    };
                } else if (['.jpg', '.jpeg', '.png', '.tiff', '.gif', '.bmp', '.webp', '.avif', '.heic', '.heif'].includes(fileExt)) {
                    // For images, use direct buffer processing to avoid Sharp issues in Lambda
                    if (!fs.existsSync(file.path)) {
                        console.error(`Image file not found: ${file.path}`);
                        return null;
                    }
                    
                    const imageBuffer = fs.readFileSync(file.path);
                    if (imageBuffer.length === 0) {
                        console.error(`Empty image file: ${file.originalname}`);
                        return null;
                    }
                    
                    // Try to process with Sharp in Lambda-safe mode
                    try {
                        let processedBuffer = imageBuffer;
                        let isJpeg = ['.jpg', '.jpeg'].includes(fileExt);
                        
                        // Only process if it's not already JPEG/PNG for PDF compatibility
                        if (!['.jpg', '.jpeg', '.png'].includes(fileExt)) {
                            const sharpInstance = sharp(imageBuffer);
                            processedBuffer = await sharpInstance.jpeg({ quality: 85 }).toBuffer();
                            isJpeg = true;
                        }
                        
                        console.log(`Image processed: ${file.originalname} -> ${processedBuffer.length} bytes`);
                        
                        return {
                            type: 'image',
                            buffer: processedBuffer,
                            isJpeg: isJpeg,
                            index
                        };
                    } catch (sharpError) {
                        console.warn(`Sharp processing failed for ${file.originalname}, using original buffer:`, sharpError.message);
                        // Fallback to original buffer
                        return {
                            type: 'image',
                            buffer: imageBuffer,
                            isJpeg: ['.jpg', '.jpeg'].includes(fileExt),
                            index
                        };
                    }
                } else {
                    console.warn(`Skipping unsupported file type: ${file.originalname} (${fileExt})`);
                    return null;
                }
            } catch (error) {
                console.error(`Error processing file ${file.originalname}:`, error.message);
                return null; // Return null for failed files, but don't stop processing
            }
        };
        
        // Process files in parallel batches to improve performance
        const batchSize = 5; // Process 5 files at a time to balance speed and memory usage
        const allResults = [];
        
        for (let i = 0; i < req.files.length; i += batchSize) {
            const batch = req.files.slice(i, i + batchSize);
            const batchPromises = batch.map((file, batchIndex) => 
                processFile(file, i + batchIndex).catch(error => {
                    console.error(`Error processing file ${file.originalname}:`, error);
                    return null; // Return null for failed files
                })
            );
            
            const batchResults = await Promise.all(batchPromises);
            allResults.push(...batchResults.filter(result => result !== null));
        }
        
        // Sort results by original index to maintain file order
        allResults.sort((a, b) => a.index - b.index);
        
        // Now merge all processed content into the PDF document
        for (const result of allResults) {
            try {
                if (result.type === 'pdf') {
                    const pages = await pdfDoc.copyPages(result.document, result.pageIndices);
                    pages.forEach((page) => pdfDoc.addPage(page));
                } else if (result.type === 'image') {
                    const image = result.isJpeg 
                        ? await pdfDoc.embedJpg(result.buffer)
                        : await pdfDoc.embedPng(result.buffer);
                    
                    // Scale image to fit standard page size if it's too large
                    const maxWidth = 595; // A4 width in points
                    const maxHeight = 842; // A4 height in points
                    let { width, height } = image;
                    
                    if (width > maxWidth || height > maxHeight) {
                        const widthRatio = maxWidth / width;
                        const heightRatio = maxHeight / height;
                        const ratio = Math.min(widthRatio, heightRatio);
                        width = width * ratio;
                        height = height * ratio;
                    }
                    
                    const page = pdfDoc.addPage([width, height]);
                    page.drawImage(image, {
                        x: 0,
                        y: 0,
                        width: width,
                        height: height,
                    });
                }
                processedFiles++;
            } catch (mergeError) {
                console.error(`Error merging file at index ${result.index}:`, mergeError);
            }
        }
        
        // Check if we have any pages
        if (pdfDoc.getPageCount() === 0 || processedFiles === 0) {
            // Provide more detailed error information
            const totalFiles = req.files.length;
            const successfulFiles = allResults.length;
            const failedFiles = totalFiles - successfulFiles;
            
            let errorMessage = `No valid files could be processed. `;
            if (failedFiles > 0) {
                errorMessage += `${failedFiles} out of ${totalFiles} files failed to process. `;
            }
            errorMessage += `Please ensure you upload supported file types: JPG, JPEG, PNG, TIFF, HEIC, HEIF, BMP, WEBP, AVIF, SVG. `;
            
            if (failedFiles > 0) {
                errorMessage += `Check the console logs for specific file processing errors.`;
            }
            
            throw new Error(errorMessage);
        }
        
        // Save the combined PDF with optimized settings
        const pdfBytes = await pdfDoc.save({
            useObjectStreams: false, // Faster for smaller files
            addDefaultPage: false,
            objectsPerTick: 50 // Process more objects per tick for better performance
        });
        const outputPath = path.join('/tmp', `combined_${Date.now()}.pdf`);
        cleanupFiles.push(outputPath);
        
        // Use streaming write for better memory efficiency
        await new Promise((resolve, reject) => {
            const writeStream = fs.createWriteStream(outputPath);
            writeStream.on('error', reject);
            writeStream.on('finish', resolve);
            writeStream.write(Buffer.from(pdfBytes));
            writeStream.end();
        });
        
        // Send the combined PDF
        const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
        const downloadName = `combined_${timestamp}.pdf`;
        
        res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
        res.setHeader('Content-Type', 'application/pdf');
        
        const fileStream = fs.createReadStream(outputPath);
        fileStream.pipe(res);
        
        fileStream.on('end', () => {
            // Clean up files after sending using Lambda helper
            cleanupTempFiles(cleanupFiles);
        });

        console.log(`Combine completed: ${processedFiles}/${req.files.length} files successfully combined to PDF (${(totalSize / 1024 / 1024).toFixed(1)}MB total) from ${clientInfo.ip}`);

    } catch (error) {
        console.error("Combine error:", error);
        
        // Clean up on error using Lambda helper
        cleanupTempFiles(cleanupFiles);
        
        // Log combine error
        try {
            const clientInfo = extractClientInfo(req);
            await logUserActivity({
                action: 'combine_error',
                error: error.message,
                files_attempted: req.files ? req.files.length : 0,
                ...clientInfo
            });
        } catch (logError) {
            console.error('Error logging combine error:', logError);
        }
        
        res.status(500).json({ 
            error: error.message || "Combine failed",
            details: "Check that your files are valid PDFs or supported image formats (JPG, PNG, etc.)"
        });
    }
});

// PDF to Word endpoint
app.post("/pdf-to-word", upload.array("files"), async (req, res) => {
    let cleanupFiles = [];
    
    try {
        const clientInfo = extractClientInfo(req);
        
        if (!req.files || req.files.length === 0) {
            // Log failed PDF to Word attempt
            await logUserActivity({
                action: 'pdf_to_word_failed',
                reason: 'no_files',
                ...clientInfo
            });
            return res.status(400).json({ error: "No files uploaded." });
        }

        // Validate that uploaded files are PDFs
        const pdfFiles = req.files.filter(file => 
            file.mimetype === 'application/pdf' || 
            file.originalname.toLowerCase().endsWith('.pdf')
        );

        if (pdfFiles.length === 0) {
            // Log failed PDF to Word attempt
            await logUserActivity({
                action: 'pdf_to_word_failed',
                reason: 'no_pdf_files',
                uploadedFileTypes: req.files.map(f => f.mimetype),
                ...clientInfo
            });
            return res.status(400).json({ error: "No PDF files found. Please upload PDF files only." });
        }

        // Track PDF to Word conversion with MongoDB
        try {
            await trackEvent('pdfToWord');
            
            // Log detailed PDF to Word activity
            const totalFileSize = pdfFiles.reduce((sum, file) => sum + file.size, 0);
            await logUserActivity({
                action: 'pdf_to_word_conversion',
                fileCount: pdfFiles.length,
                fileSize: totalFileSize,
                ...clientInfo
            });
        } catch (trackError) {
            console.error('Error tracking PDF to Word (non-critical):', trackError);
        }
        
        // Add all files to cleanup list
        cleanupFiles.push(...req.files.map(f => f.path));
        
        if (pdfFiles.length === 1) {
            // Single file conversion
            const file = pdfFiles[0];
            const outputPath = path.join('/tmp', `converted_${Date.now()}.docx`);
            cleanupFiles.push(outputPath);
            
            try {
                // Use pdf-parse to extract text content
                const pdfParse = require('pdf-parse');
                const pdfBuffer = fs.readFileSync(file.path);
                const pdfData = await pdfParse(pdfBuffer);
                
                // Create Word document using docx library
                const { Document, Packer, Paragraph, TextRun } = require('docx');
                
                // Split text into paragraphs
                const paragraphs = pdfData.text.split('\n\n').filter(p => p.trim().length > 0);
                
                const doc = new Document({
                    sections: [{
                        properties: {},
                        children: paragraphs.map(text => 
                            new Paragraph({
                                children: [new TextRun(text.trim())]
                            })
                        )
                    }]
                });
                
                const buffer = await Packer.toBuffer(doc);
                fs.writeFileSync(outputPath, buffer);
                
                // Send the converted file
                const originalName = path.parse(file.originalname).name;
                const downloadName = `${originalName}.docx`;
                
                res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
                res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
                
                const fileStream = fs.createReadStream(outputPath);
                fileStream.pipe(res);
                
                fileStream.on('end', () => {
                    // Clean up files after sending
                    cleanupFiles.forEach(filePath => {
                        try {
                            if (fs.existsSync(filePath)) {
                                fs.unlinkSync(filePath);
                            }
                        } catch (cleanupError) {
                            console.error('Cleanup error:', cleanupError);
                        }
                    });
                });
                
            } catch (conversionError) {
                throw new Error(`PDF to Word conversion failed: ${conversionError.message}`);
            }
            
        } else {
            // Multiple files - create a ZIP
            const { createCompatibleZip } = require('./utils/compatibleZip');
            const zipPath = path.join('/tmp', `converted_pdfs_${Date.now()}.zip`);
            cleanupFiles.push(zipPath);
            
            let convertedDocuments = [];
            
            // Process each PDF file
            for (let i = 0; i < pdfFiles.length; i++) {
                const file = pdfFiles[i];
                
                try {
                    // Use pdf-parse to extract text content
                    const pdfParse = require('pdf-parse');
                    const pdfBuffer = fs.readFileSync(file.path);
                    const pdfData = await pdfParse(pdfBuffer);
                    
                    // Create Word document using docx library
                    const { Document, Packer, Paragraph, TextRun } = require('docx');
                    
                    // Split text into paragraphs
                    const paragraphs = pdfData.text.split('\n\n').filter(p => p.trim().length > 0);
                    
                    const doc = new Document({
                        sections: [{
                            properties: {},
                            children: paragraphs.map(text => 
                                new Paragraph({
                                    children: [new TextRun(text.trim())]
                                })
                            )
                        }]
                    });
                    
                    const buffer = await Packer.toBuffer(doc);
                    const originalName = path.parse(file.originalname).name;
                    
                    convertedDocuments.push({
                        buffer: buffer,
                        name: `${originalName}.docx`
                    });
                    
                } catch (fileError) {
                    console.error(`Error converting ${file.originalname}:`, fileError);
                    // Add error file to collection
                    convertedDocuments.push({
                        buffer: Buffer.from(`Error converting ${file.originalname}: ${fileError.message}`, 'utf8'),
                        name: `ERROR_${file.originalname}.txt`
                    });
                }
            }
            
            // Create ZIP file with converted documents
            try {
                await createCompatibleZip({
                    outputPath: zipPath,
                    files: convertedDocuments
                });
                
                // Send the ZIP file
                const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
                const downloadName = `converted_pdfs_${timestamp}.zip`;
                
                res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
                res.setHeader('Content-Type', 'application/zip');
                
                // Check if running in Lambda environment
                const isLambda = process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT;
                
                if (isLambda) {
                    // For Lambda, read file as buffer and send directly
                    const zipBuffer = fs.readFileSync(zipPath);
                    res.end(zipBuffer);
                } else {
                    // For regular servers, use streaming
                    const fileStream = fs.createReadStream(zipPath);
                    fileStream.pipe(res);
                }
                
                // Clean up files after sending
                setTimeout(() => {
                    // Clean up files after sending
                    cleanupFiles.forEach(filePath => {
                        try {
                            if (fs.existsSync(filePath)) {
                                fs.unlinkSync(filePath);
                            }
                        } catch (cleanupError) {
                            console.error('Cleanup error:', cleanupError);
                        }
                    });
                });
                
            } catch (zipError) {
                console.error('ZIP creation failed:', zipError);
                throw new Error(`Failed to create ZIP file: ${zipError.message}`);
            }
        }

        console.log(`PDF to Word completed: ${pdfFiles.length} files from ${clientInfo.ip}`);

    } catch (error) {
        console.error("PDF to Word error:", error);
        
        // Clean up on error
        cleanupFiles.forEach(filePath => {
            try {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            } catch (cleanupError) {
                console.error('Cleanup error:', cleanupError);
            }
        });
        
        // Log PDF to Word error
        try {
            const clientInfo = extractClientInfo(req);
            await logUserActivity({
                action: 'pdf_to_word_error',
                error: error.message,
                ...clientInfo
            });
        } catch (logError) {
            console.error('Error logging PDF to Word error:', logError);
        }
        
        res.status(500).json({ error: error.message || "PDF to Word conversion failed" });
    }
});

// PDF to Images endpoint
app.post("/pdf-to-images", upload.array("files"), async (req, res) => {
    let cleanupFiles = [];
    
    try {
        const clientInfo = extractClientInfo(req);
        
        if (!req.files || req.files.length === 0) {
            // Log failed PDF to Images attempt
            await logUserActivity({
                action: 'pdf_to_images_failed',
                reason: 'no_files',
                ...clientInfo
            });
            return res.status(400).json({ error: "No files uploaded." });
        }

        // Validate that uploaded files are PDFs
        const pdfFiles = req.files.filter(file => 
            file.mimetype === 'application/pdf' || 
            file.originalname.toLowerCase().endsWith('.pdf')
        );

        if (pdfFiles.length === 0) {
            // Log failed PDF to Images attempt
            await logUserActivity({
                action: 'pdf_to_images_failed',
                reason: 'no_pdf_files',
                uploadedFileTypes: req.files.map(f => f.mimetype),
                ...clientInfo
            });
            return res.status(400).json({ error: "No PDF files found. Please upload PDF files only." });
        }

        // Track PDF to Images conversion with MongoDB
        try {
            await trackEvent('pdfToImages');
            
            // Log detailed PDF to Images activity
            const totalFileSize = pdfFiles.reduce((sum, file) => sum + file.size, 0);
            await logUserActivity({
                action: 'pdf_to_images_conversion',
                fileCount: pdfFiles.length,
                fileSize: totalFileSize,
                ...clientInfo
            });
        } catch (trackError) {
            console.error('Error tracking PDF to Images (non-critical):', trackError);
        }
        
        // Add all files to cleanup list
        cleanupFiles.push(...req.files.map(f => f.path));
        
        const format = req.body.output_format || 'png';
        
        // Collect all image files first, then create ZIP
        const { createCompatibleZip } = require('./utils/compatibleZip');
        const zipPath = path.join('/tmp', `pdf_to_images_${Date.now()}.zip`);
        cleanupFiles.push(zipPath);
        
        let singleImageBuffer = null;
        let singleImageName = '';
        let totalImages = 0;
        let collectedFiles = []; // Collect files before creating ZIP
        
        // Process each PDF file
        for (const file of pdfFiles) {
            try {
                // Check if we're in AWS Lambda or Vercel environment
                const isLambda = process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT;
                const isVercel = process.env.VERCEL || process.env.NOW_REGION;
                
                if (isLambda || isVercel) {
                    // For Vercel, use pdf2pic library
                    const pdf2pic = require('pdf2pic');
                    
                    const convert = pdf2pic.fromPath(file.path, {
                        density: 150,
                        saveFilename: "page",
                        savePath: "/tmp",
                        format: format === 'jpg' ? 'jpeg' : format,
                        width: 1024,
                        height: 1024,
                        quality: format === 'jpg' ? 85 : undefined // Only set quality for JPEG
                    });
                    
                    try {
                        const results = await convert.bulk(-1); // Convert all pages
                        
                        if (results && results.length > 0) {
                            const originalName = path.parse(file.originalname).name;
                            
                            results.forEach((result, pageIndex) => {
                                if (result.buffer && result.buffer.length > 0) {
                                    const fileName = results.length === 1 && pdfFiles.length === 1
                                        ? `${originalName}.${format}`
                                        : `${originalName}_page_${pageIndex + 1}.${format}`;
                                    
                                    // Ensure we have a valid buffer
                                    const validBuffer = Buffer.isBuffer(result.buffer) ? result.buffer : Buffer.from(result.buffer);
                                    
                                    // Collect file for later ZIP creation
                                    collectedFiles.push({
                                        buffer: validBuffer,
                                        name: fileName
                                    });
                                    
                                    // If this is the only image, save it for direct download
                                    if (results.length === 1 && pdfFiles.length === 1) {
                                        singleImageBuffer = validBuffer;
                                        singleImageName = fileName;
                                    }
                                    
                                    totalImages++;
                                }
                            });
                        } else {
                            throw new Error('No images generated from PDF using pdf2pic');
                        }
                    } catch (pdf2picError) {
                        console.error('pdf2pic failed:', pdf2picError.message);
                        throw pdf2picError;
                    }
                } else {
                    // For local development, use system pdftocairo
                    const { spawn } = require('child_process');
                    
                    // Create output directory for this file
                    const outputDir = path.join('/tmp', `pdf_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);
                    fs.mkdirSync(outputDir, { recursive: true });
                    cleanupFiles.push(outputDir);
                    
                    // Use system pdftocairo with proper PATH
                    const outputBaseName = path.join(outputDir, 'page');
                    const pdftocairoArgs = [
                        `-${format}`,
                        '-scale-to', '1024',
                        '-r', '150',  // Set resolution explicitly
                        file.path,
                        outputBaseName
                    ];
                    
                    // Use system pdftocairo with proper PATH
                    const pdftocairoPath = '/opt/homebrew/bin/pdftocairo';
                    
                    await new Promise((resolve, reject) => {
                        const child = spawn(pdftocairoPath, pdftocairoArgs, {
                            env: { ...process.env, PATH: '/opt/homebrew/bin:' + process.env.PATH }
                        });
                        
                        let stderr = '';
                        child.stderr.on('data', (data) => {
                            stderr += data.toString();
                        });
                        
                        child.on('close', (code) => {
                            if (code === 0) {
                                resolve();
                            } else {
                                reject(new Error(`pdftocairo exited with code ${code}: ${stderr}`));
                            }
                        });
                        
                        child.on('error', (err) => {
                            reject(err);
                        });
                    });
                    
                    // Read all generated images
                    const imageFiles = fs.readdirSync(outputDir).filter(f => 
                        f.startsWith('page') && 
                        (f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.jpeg') || f.endsWith('.tiff') || f.endsWith('.webp'))
                    );
                    
                    if (imageFiles.length > 0) {
                        const originalName = path.parse(file.originalname).name;
                        
                        // Process each generated image
                        imageFiles.forEach((imageFile, pageIndex) => {
                            const imagePath = path.join(outputDir, imageFile);
                            
                            // Verify file exists and is readable
                            if (fs.existsSync(imagePath)) {
                                const imageBuffer = fs.readFileSync(imagePath);
                                
                                if (imageBuffer && imageBuffer.length > 0) {
                                    const fileName = imageFiles.length === 1 && pdfFiles.length === 1
                                        ? `${originalName}.${format}`
                                        : `${originalName}_page_${pageIndex + 1}.${format}`;
                                    
                                    // Collect file for later ZIP creation
                                    collectedFiles.push({
                                        buffer: imageBuffer,
                                        name: fileName
                                    });
                                    
                                    // If this is the only image, save it for direct download
                                    if (imageFiles.length === 1 && pdfFiles.length === 1) {
                                        singleImageBuffer = imageBuffer;
                                        singleImageName = fileName;
                                    }
                                    
                                    totalImages++;
                                }
                            }
                        });
                    } else {
                        throw new Error('No images generated from PDF');
                    }
                }
                
            } catch (conversionError) {
                console.error('PDF conversion failed, using text extraction fallback:', conversionError.message);
                
                // Fallback: Extract text and create a simple text image
                const pdfParse = require('pdf-parse');
                const pdfBuffer = fs.readFileSync(file.path);
                const pdfData = await pdfParse(pdfBuffer);
                
                // Create a simple text representation
                const originalName = path.parse(file.originalname).name;
                const textContent = `PDF Text Content from: ${file.originalname}\n\n${pdfData.text}`;
                
                // Create a simple text file as fallback
                const textFileName = `${originalName}_text_content.txt`;
                collectedFiles.push({
                    buffer: Buffer.from(textContent, 'utf8'),
                    name: textFileName
                });
                
                // Also create an error notice
                const errorNotice = `PDF to Images conversion failed.\n\nError: ${conversionError.message}\n\nText content has been extracted instead.`;
                collectedFiles.push({
                    buffer: Buffer.from(errorNotice, 'utf8'),
                    name: `CONVERSION_INFO_${originalName}.txt`
                });
                
                totalImages++;
            }
        }
        
        // If we have only one image, send it directly instead of a ZIP
        if (totalImages === 1 && singleImageBuffer) {
            res.setHeader('Content-Disposition', `attachment; filename="${singleImageName}"`);
            res.setHeader('Content-Type', `image/${format === 'jpg' ? 'jpeg' : format}`);
            res.send(singleImageBuffer);
            
            // Clean up files
            cleanupFiles.forEach(filePath => {
                try {
                    if (fs.existsSync(filePath)) {
                        if (fs.lstatSync(filePath).isDirectory()) {
                            fs.rmSync(filePath, { recursive: true, force: true });
                        } else {
                            fs.unlinkSync(filePath);
                        }
                    }
                } catch (cleanupError) {
                    console.error('Cleanup error:', cleanupError);
                }
            });
        } else {
            // Create ZIP file with collected files
            try {
                await createCompatibleZip({
                    outputPath: zipPath,
                    files: collectedFiles
                });
                
                // Send the ZIP file
                const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
                const downloadName = pdfFiles.length === 1 
                    ? `${path.parse(pdfFiles[0].originalname).name}_images.zip`
                    : `pdf_to_images_${timestamp}.zip`;
                
                res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
                res.setHeader('Content-Type', 'application/zip');
                
                // Check if running in Lambda environment
                const isLambda = process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT;
                
                if (isLambda) {
                    // For Lambda, read file as buffer and send directly
                    const zipBuffer = fs.readFileSync(zipPath);
                    res.end(zipBuffer);
                } else {
                    // For regular servers, use streaming
                    const fileStream = fs.createReadStream(zipPath);
                    fileStream.pipe(res);
                }
                
                // Clean up files after sending
                setTimeout(() => {
                    // Clean up files after sending
                    cleanupFiles.forEach(filePath => {
                        try {
                            if (fs.existsSync(filePath)) {
                                if (fs.lstatSync(filePath).isDirectory()) {
                                    fs.rmSync(filePath, { recursive: true, force: true });
                                } else {
                                    fs.unlinkSync(filePath);
                                }
                            }
                        } catch (cleanupError) {
                            console.error('Cleanup error:', cleanupError);
                        }
                    });
                });
                
            } catch (zipError) {
                console.error('ZIP creation failed:', zipError);
                throw new Error(`Failed to create ZIP file: ${zipError.message}`);
            }
        }

        console.log(`PDF to Images completed: ${pdfFiles.length} files from ${clientInfo.ip}`);

    } catch (error) {
        console.error("PDF to Images error:", error);
        
        // Clean up on error
        cleanupFiles.forEach(filePath => {
            try {
                if (fs.existsSync(filePath)) {
                    if (fs.lstatSync(filePath).isDirectory()) {
                        fs.rmSync(filePath, { recursive: true, force: true });
                    } else {
                        fs.unlinkSync(filePath);
                    }
                }
            } catch (cleanupError) {
                console.error('Cleanup error:', cleanupError);
            }
        });
        
        // Log PDF to Images error
        try {
            const clientInfo = extractClientInfo(req);
            await logUserActivity({
                action: 'pdf_to_images_error',
                error: error.message,
                ...clientInfo
            });
        } catch (logError) {
            console.error('Error logging PDF to Images error:', logError);
        }
        
        res.status(500).json({ error: error.message || "PDF to Images conversion failed" });
    }
});

// Serve static files (CSS, JS, images)
app.use(express.static(path.join(__dirname, "..", "public")));

// Main HTML for root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// HTML page routes
app.get('/convert', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'convert.html'));
});

app.get('/combine', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'combine.html'));
});

app.get('/pdf-to-word', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'pdf-to-word.html'));
});

app.get('/pdf-to-images', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'pdf-to-images.html'));
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({ 
        error: 'Not found',
        path: req.originalUrl 
    });
});

// Error handler
app.use((error, req, res, next) => {
    console.error('Server error:', error);
    res.status(500).json({ 
        error: 'Internal server error',
        message: error.message
    });
});

// Start server in development
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    const server = app.listen(PORT, () => {
        console.log(`Serverless-compatible server running on port ${PORT}`);
    });

    // Graceful shutdown
    process.on('SIGTERM', async () => {
        console.log('SIGTERM received, shutting down gracefully');
        server.close(async () => {
            try {
                const db = require('./database');
                await db.closeDatabase();
                console.log('Database connections closed');
            } catch (error) {
                console.error('Error closing database:', error);
            }
            process.exit(0);
        });
    });

    process.on('SIGINT', async () => {
        console.log('SIGINT received, shutting down gracefully');
        server.close(async () => {
            try {
                const db = require('./database');
                await db.closeDatabase();
                console.log('Database connections closed');
            } catch (error) {
                console.error('Error closing database:', error);
            }
            process.exit(0);
        });
    });
}

// Export for serverless
module.exports = app;
