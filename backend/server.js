const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { PDFDocument } = require("pdf-lib");

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
        totalPdfToWord: 0
    });
    trackEvent = async () => {};
    logUserActivity = async () => {};
    getUserActivityStats = async () => [];
    getRecentUserActivities = async () => [];
    extractClientInfo = () => ({ ip: '127.0.0.1', userAgent: 'Unknown' });
}

// Initialize Express app
const app = express();

// Configure multer for serverless (use /tmp directory)
const upload = multer({ 
    dest: '/tmp',
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB limit
        files: 5 // Max 5 files
    }
});

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
const supportedFormats = ["jpg", "png", "tiff", "pdf", "heic", "gif", "bmp", "webp", "avif", "svg"];
const supportedMimetypes = [
    "image/jpg", "image/jpeg", "image/png", "image/tiff", "image/heic", "image/heif",
    "image/gif", "image/bmp", "image/webp", "image/avif", "image/svg+xml"
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
        
        // Process only the first file for single file conversion
        const file = req.files[0];
        cleanupFiles.push(file.path);
        
        const inputExt = path.extname(file.originalname).toLowerCase().slice(1);
        const outputPath = path.join('/tmp', `converted_${Date.now()}.${format}`);
        cleanupFiles.push(outputPath);
        
        console.log(`Converting ${file.originalname} (${inputExt}) to ${format}`);
        
        // Handle different conversion types
        if (format === 'pdf') {
            // Convert images to PDF
            if (['jpg', 'jpeg', 'png', 'tiff', 'heic', 'gif', 'bmp', 'webp', 'avif'].includes(inputExt)) {
                const pdfDoc = await PDFDocument.create();
                
                let imageBuffer;
                if (inputExt === 'heic' || inputExt === 'heif') {
                    const heicConvert = require('heic-convert');
                    const heicBuffer = fs.readFileSync(file.path);
                    imageBuffer = await heicConvert({
                        buffer: heicBuffer,
                        format: 'PNG'
                    });
                } else {
                    imageBuffer = await sharp(file.path)
                        .png()
                        .toBuffer();
                }
                
                const image = await pdfDoc.embedPng(imageBuffer);
                const page = pdfDoc.addPage([image.width, image.height]);
                page.drawImage(image, {
                    x: 0,
                    y: 0,
                    width: image.width,
                    height: image.height,
                });
                
                const pdfBytes = await pdfDoc.save();
                fs.writeFileSync(outputPath, pdfBytes);
            } else {
                throw new Error(`Cannot convert ${inputExt} to PDF`);
            }
        } else if (['jpg', 'jpeg', 'png', 'tiff', 'gif', 'bmp', 'webp', 'avif'].includes(format)) {
            // Convert to image formats using Sharp
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
                case 'gif':
                    await sharpInstance.gif().toFile(outputPath);
                    break;
                case 'bmp':
                    await sharpInstance.png().toFile(outputPath);
                    break;
                default:
                    throw new Error(`Unsupported output format: ${format}`);
            }
        } else {
            throw new Error(`Unsupported conversion: ${inputExt} to ${format}`);
        }
        
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

        console.log(`Conversion completed: ${file.originalname} to ${format} from ${clientInfo.ip}`);

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
        
        // Create a new PDF document
        const pdfDoc = await PDFDocument.create();
        
        // Process each uploaded file
        for (let i = 0; i < req.files.length; i++) {
            const file = req.files[i];
            const fileExt = path.extname(file.originalname).toLowerCase();
            
            console.log(`Processing file ${i + 1}/${req.files.length}: ${file.originalname}`);
            
            try {
                if (fileExt === '.pdf') {
                    // If it's a PDF, merge it
                    const existingPdfBytes = fs.readFileSync(file.path);
                    const existingPdf = await PDFDocument.load(existingPdfBytes);
                    const pages = await pdfDoc.copyPages(existingPdf, existingPdf.getPageIndices());
                    pages.forEach((page) => pdfDoc.addPage(page));
                } else if (['.jpg', '.jpeg', '.png', '.tiff', '.gif', '.bmp', '.webp', '.avif'].includes(fileExt)) {
                    // If it's an image, convert and add it
                    let imageBuffer;
                    
                    if (fileExt === '.heic' || fileExt === '.heif') {
                        const heicConvert = require('heic-convert');
                        const heicFileBuffer = fs.readFileSync(file.path);
                        imageBuffer = await heicConvert({
                            buffer: heicFileBuffer,
                            format: 'PNG'
                        });
                    } else {
                        imageBuffer = await sharp(file.path)
                            .rotate() // Auto-orient based on EXIF data
                            .png()
                            .toBuffer();
                    }
                    
                    const image = await pdfDoc.embedPng(imageBuffer);
                    const page = pdfDoc.addPage([image.width, image.height]);
                    page.drawImage(image, {
                        x: 0,
                        y: 0,
                        width: image.width,
                        height: image.height,
                    });
                } else {
                    console.warn(`Skipping unsupported file type: ${file.originalname}`);
                }
            } catch (fileError) {
                console.error(`Error processing file ${file.originalname}:`, fileError);
                // Continue with other files
            }
        }
        
        // Check if we have any pages
        if (pdfDoc.getPageCount() === 0) {
            throw new Error('No valid files to combine. Please upload PDF or image files.');
        }
        
        // Save the combined PDF
        const pdfBytes = await pdfDoc.save();
        const outputPath = path.join('/tmp', `combined_${Date.now()}.pdf`);
        cleanupFiles.push(outputPath);
        fs.writeFileSync(outputPath, pdfBytes);
        
        // Send the combined PDF
        const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
        const downloadName = `combined_${timestamp}.pdf`;
        
        res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
        res.setHeader('Content-Type', 'application/pdf');
        
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

        console.log(`Combine completed: ${req.files.length} files combined to PDF from ${clientInfo.ip}`);

    } catch (error) {
        console.error("Combine error:", error);
        
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
        
        // Log combine error
        try {
            const clientInfo = extractClientInfo(req);
            await logUserActivity({
                action: 'combine_error',
                error: error.message,
                ...clientInfo
            });
        } catch (logError) {
            console.error('Error logging combine error:', logError);
        }
        
        res.status(500).json({ error: error.message || "Combine failed" });
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
            const archiver = require('archiver');
            const zipPath = path.join('/tmp', `converted_${Date.now()}.zip`);
            cleanupFiles.push(zipPath);
            
            const output = fs.createWriteStream(zipPath);
            const archive = archiver('zip', { zlib: { level: 9 } });
            
            archive.pipe(output);
            
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
                    archive.append(buffer, { name: `${originalName}.docx` });
                    
                } catch (fileError) {
                    console.error(`Error converting ${file.originalname}:`, fileError);
                    // Add error file to ZIP
                    archive.append(`Error converting ${file.originalname}: ${fileError.message}`, { 
                        name: `ERROR_${file.originalname}.txt` 
                    });
                }
            }
            
            archive.finalize();
            
            output.on('close', () => {
                // Send the ZIP file
                const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
                const downloadName = `converted_pdfs_${timestamp}.zip`;
                
                res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
                res.setHeader('Content-Type', 'application/zip');
                
                const fileStream = fs.createReadStream(zipPath);
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
            });
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
