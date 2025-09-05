const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const cors = require("cors");
const { PDFDocument } = require("pdf-lib");
const zipFiles = require('./zipFiles');
const pdfParse = require('pdf-parse');
const { Document, Packer, Paragraph, TextRun } = require("docx");
const { loadStats, trackEvent } = require('./database');

// Load environment variables
require('dotenv').config();

// Initialize Express app
const app = express();
const upload = multer({ dest: "uploads/" });

// Enable CORS
app.use(cors());

// API endpoint to get stats
app.get('/api/stats', async (req, res) => {
    try {
        const stats = await loadStats();
        res.json(stats);
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// Middleware to track page visits
app.use(async (req, res, next) => {
    // Only track visits to main pages, not assets
    if (req.path === '/' || req.path.endsWith('.html')) {
        try {
            await trackEvent('visit');
        } catch (error) {
            console.error('Error tracking visit:', error);
        }
    }
    next();
});

// Serve static files from the "frontend" folder
app.use(express.static(path.join(__dirname, "frontend")));

// Middleware to parse form data correctly
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve main HTML for root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

// Supported formats
const supportedFormats = ["jpg", "png", "tiff", "pdf", "heic", "gif", "bmp", "webp", "avif", "svg"];
const supportedMimetypes = [
    "image/jpg", "image/jpeg", "image/png", "image/tiff", "image/heic", "image/heif",
    "image/gif", "image/bmp", "image/webp", "image/avif", "image/svg+xml"
];

// Convert file endpoint
app.post("/convert", upload.array("files"), async (req, res) => {
    try {
        // Track conversion event
        await trackEvent('conversion');
        
        const format = req.body.output_format.toLowerCase();
        if (!format || !supportedFormats.includes(format)) {
            return res.status(400).json({ error: `Invalid format. Supported formats: ${supportedFormats.join(", ")}.` });
        }
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: "No files uploaded." });
        }
        const convertedFiles = [];
        for (let file of req.files) {
            const inputPath = file.path;
            const ext = path.extname(file.originalname).toLowerCase();
            const outputPath = path.join(uploadsDir, `${file.filename}.${format}`);
            try {
                // Accept common image extensions if mimetype is not recognized
                const allowedExtensions = [".jpg", ".jpeg", ".png", ".tiff", ".heic", ".heif", ".gif", ".bmp", ".webp", ".avif", ".svg"];
                const fileExt = path.extname(file.originalname).toLowerCase();
                if (supportedMimetypes.includes(file.mimetype) || allowedExtensions.includes(fileExt)) {
                    // Image conversion (including SVG rasterization)
                    let sharpInstance = sharp(inputPath);
                    if (file.mimetype === "image/svg+xml" || fileExt === ".svg") {
                        sharpInstance = sharp(inputPath).png();
                    }
                    if (format === "tiff") {
                        await sharpInstance.tiff({ compression: "lzw", quality: 100 }).toFile(outputPath);
                    } else if (format === "jpg") {
                        await sharpInstance.jpeg({ quality: 90 }).toFile(outputPath);
                    } else if (format === "png") {
                        await sharpInstance.png({ quality: 90 }).toFile(outputPath);
                    } else if (format === "heic") {
                        await sharpInstance.heif({ quality: 90 }).toFile(outputPath);
                    } else if (format === "gif") {
                        await sharpInstance.gif().toFile(outputPath);
                    } else if (format === "bmp") {
                        await sharpInstance.bmp().toFile(outputPath);
                    } else if (format === "webp") {
                        await sharpInstance.webp({ quality: 90 }).toFile(outputPath);
                    } else if (format === "avif") {
                        await sharpInstance.avif({ quality: 90 }).toFile(outputPath);
                    } else if (format === "pdf") {
                        // Convert image to PDF
                        const imageBuffer = await sharpInstance.toBuffer();
                        const pdfDoc = await PDFDocument.create();
                        let image;
                        if (["image/png", "image/webp", "image/avif", "image/svg+xml"].includes(file.mimetype) || format === "png" || fileExt === ".png") {
                            image = await pdfDoc.embedPng(imageBuffer);
                        } else {
                            image = await pdfDoc.embedJpg(imageBuffer);
                        }
                        const page = pdfDoc.addPage([image.width, image.height]);
                        page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
                        const pdfBytes = await pdfDoc.save();
                        fs.writeFileSync(outputPath, pdfBytes);
                    }
                } else if (file.mimetype === "application/pdf" && format !== "pdf") {
                    throw new Error("PDF to image conversion is not supported in this version.");
                } else {
                    throw new Error(`Invalid file type. Only common image types and PDF files are supported. File: ${file.originalname}`);
                }
                if (fs.existsSync(outputPath)) {
                    convertedFiles.push(outputPath);
                } else {
                    throw new Error("Output file not found after conversion.");
                }
            } catch (sharpError) {
                return res.status(500).json({ error: sharpError.message || "Image processing failed." });
            } finally {
                if (fs.existsSync(inputPath)) {
                    fs.unlinkSync(inputPath);
                }
            }
        }
        if (convertedFiles.length === 1) {
            res.download(convertedFiles[0], `converted.${format}`, (err) => {
                if (fs.existsSync(convertedFiles[0])) {
                    fs.unlinkSync(convertedFiles[0]);
                }
            });
        } else if (convertedFiles.length > 1) {
            // Zip multiple files and send
            const zipPath = path.join(uploadsDir, `converted_files_${Date.now()}.zip`);
            await zipFiles(convertedFiles, zipPath);
            res.download(zipPath, `converted_files.zip`, (err) => {
                // Clean up zip and converted files
                if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
                convertedFiles.forEach(file => {
                    if (fs.existsSync(file)) fs.unlinkSync(file);
                });
            });
        } else {
            res.status(500).json({ error: "No files converted." });
        }
    } catch (error) {
        res.status(500).json({ error: error.message || "Conversion failed. Please try again." });
    }
});

// Combine files endpoint
app.post("/combine", upload.array("files"), async (req, res) => {
    try {
        // Track combine event
        await trackEvent('combine');
        
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: "No files uploaded." });
        }
        const pdfDoc = await PDFDocument.create();
        for (let file of req.files) {
            const inputPath = file.path;
            const fileExt = path.extname(file.originalname).toLowerCase();
            
            try {
                if (file.mimetype === "application/pdf" || fileExt === ".pdf") {
                    // Handle PDF files
                    const pdfBytes = fs.readFileSync(inputPath);
                    const externalPdf = await PDFDocument.load(pdfBytes);
                    const copiedPages = await pdfDoc.copyPages(externalPdf, externalPdf.getPageIndices());
                    copiedPages.forEach(page => pdfDoc.addPage(page));
                } else if (
                    ["image/jpg", "image/jpeg", "image/png", "image/tiff", "image/heic", "image/heif", "image/gif", "image/bmp", "image/webp", "image/avif", "image/svg+xml"].includes(file.mimetype)
                    || [".jpg", ".jpeg", ".png", ".tiff", ".heic", ".heif", ".gif", ".bmp", ".webp", ".avif", ".svg"].includes(fileExt)
                ) {
                    // Handle image files
                    let imageBuffer;
                    
                    // Convert all images to PNG for consistent embedding
                    if (
                        file.mimetype === "image/svg+xml" || fileExt === ".svg" ||
                        file.mimetype === "image/gif" || fileExt === ".gif" ||
                        file.mimetype === "image/bmp" || fileExt === ".bmp" ||
                        file.mimetype === "image/webp" || fileExt === ".webp" ||
                        file.mimetype === "image/avif" || fileExt === ".avif" ||
                        file.mimetype === "image/heic" || fileExt === ".heic" ||
                        file.mimetype === "image/heif" || fileExt === ".heif" ||
                        file.mimetype === "image/tiff" || fileExt === ".tiff"
                    ) {
                        // Convert to PNG for these formats
                        imageBuffer = await sharp(inputPath).png().toBuffer();
                    } else if (file.mimetype === "image/png" || fileExt === ".png") {
                        // PNG files can be used directly
                        imageBuffer = fs.readFileSync(inputPath);
                    } else {
                        // JPG files - convert to PNG for consistency
                        imageBuffer = await sharp(inputPath).png().toBuffer();
                    }
                    
                    const image = await pdfDoc.embedPng(imageBuffer);
                    const page = pdfDoc.addPage([image.width, image.height]);
                    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
                } else {
                    throw new Error(`Unsupported file type: ${file.originalname}. Only PDF and image files are supported.`);
                }
            } catch (fileError) {
                console.error(`Error processing file ${file.originalname}:`, fileError);
                throw new Error(`Failed to process file ${file.originalname}: ${fileError.message}`);
            }
            
            // Clean up uploaded file
            if (fs.existsSync(inputPath)) {
                fs.unlinkSync(inputPath);
            }
        }
        
        const pdfBytes = await pdfDoc.save();
        const timestamp = Date.now();
        const outputPath = path.join(uploadsDir, `combined_${timestamp}.pdf`);
        fs.writeFileSync(outputPath, pdfBytes);
        
        res.download(outputPath, `combined_${timestamp}.pdf`, (err) => {
            if (fs.existsSync(outputPath)) {
                fs.unlinkSync(outputPath);
            }
        });
    } catch (error) {
        console.error("Combination error:", error);
        res.status(500).json({ error: error.message || "Combination failed. Please try again." });
    }
});

// PDF to Word conversion endpoint
app.post("/pdf-to-word", upload.array("files"), async (req, res) => {
    try {
        // Track PDF to Word conversion event
        await trackEvent('pdfToWord');
        
        const format = req.body.output_format || "docx";
        if (!["docx", "doc"].includes(format)) {
            return res.status(400).json({ error: "Invalid format. Supported formats: docx, doc." });
        }
        
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: "No PDF files uploaded." });
        }
        
        const convertedFiles = [];
        
        for (let file of req.files) {
            const inputPath = file.path;
            const fileExt = path.extname(file.originalname).toLowerCase();
            
            // Check if it's a PDF file
            if (file.mimetype !== "application/pdf" && fileExt !== ".pdf") {
                // Clean up uploaded file
                if (fs.existsSync(inputPath)) {
                    fs.unlinkSync(inputPath);
                }
                continue;
            }
            
            try {
                // Read and parse PDF
                const pdfBuffer = fs.readFileSync(inputPath);
                const pdfData = await pdfParse(pdfBuffer);
                const extractedText = pdfData.text;
                
                if (!extractedText || extractedText.trim().length === 0) {
                    throw new Error("No text content found in PDF");
                }
                
                // Create Word document
                const doc = new Document({
                    sections: [{
                        properties: {},
                        children: [
                            new Paragraph({
                                children: [
                                    new TextRun({
                                        text: extractedText,
                                        font: "Arial",
                                        size: 24, // 12pt
                                    }),
                                ],
                            }),
                        ],
                    }],
                });
                
                // Generate the document
                const buffer = await Packer.toBuffer(doc);
                const outputPath = path.join(uploadsDir, `${file.filename}.${format}`);
                fs.writeFileSync(outputPath, buffer);
                
                if (fs.existsSync(outputPath)) {
                    convertedFiles.push(outputPath);
                } else {
                    throw new Error("Output file not found after conversion.");
                }
                
            } catch (conversionError) {
                console.error(`Error converting ${file.originalname}:`, conversionError);
                throw new Error(`Failed to convert ${file.originalname}: ${conversionError.message}`);
            } finally {
                // Clean up uploaded file
                if (fs.existsSync(inputPath)) {
                    fs.unlinkSync(inputPath);
                }
            }
        }
        
        if (convertedFiles.length === 0) {
            return res.status(400).json({ error: "No valid PDF files were processed." });
        }
        
        // Send response
        if (convertedFiles.length === 1) {
            // Single file download
            const fileName = `converted.${format}`;
            res.download(convertedFiles[0], fileName, (err) => {
                if (fs.existsSync(convertedFiles[0])) {
                    fs.unlinkSync(convertedFiles[0]);
                }
            });
        } else {
            // Multiple files - zip them
            const zipPath = path.join(uploadsDir, `pdf_to_word_${Date.now()}.zip`);
            await zipFiles(convertedFiles, zipPath);
            res.download(zipPath, `pdf_to_word_converted.zip`, (err) => {
                // Clean up zip and converted files
                if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
                convertedFiles.forEach(file => {
                    if (fs.existsSync(file)) fs.unlinkSync(file);
                });
            });
        }
        
    } catch (error) {
        console.error("PDF to Word conversion error:", error);
        res.status(500).json({ error: error.message || "PDF to Word conversion failed. Please try again." });
    }
});

// Start the server
app.listen(3000, () => {
    console.log("Server running on http://localhost:3000");
});