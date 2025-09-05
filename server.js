const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { PDFDocument } = require("pdf-lib");

// Load environment variables
require('dotenv').config();

// Database functions with error handling
let loadStats, trackEvent;
try {
    const db = require('./database');
    loadStats = db.loadStats;
    trackEvent = db.trackEvent;
    console.log('Database module loaded successfully');
    
    // Test connection asynchronously (non-blocking)
    setTimeout(async () => {
        try {
            await db.connectToDatabase();
            console.log('MongoDB connection test completed');
        } catch (error) {
            console.warn('MongoDB connection test failed (non-critical):', error.message);
        }
    }, 1000);
} catch (error) {
    console.warn('Database module not available, using fallbacks:', error.message);
    loadStats = async () => ({
        totalVisits: 0,
        totalConversions: 0,
        totalCombines: 0,
        totalPdfToWord: 0
    });
    trackEvent = async () => {};
}

// Initialize Express app
const app = express();

// Configure multer for serverless (use /tmp directory)
const upload = multer({ 
    dest: '/tmp',
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB limit
        files: 10 // Max 10 files
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
    try {
        const stats = await loadStats();
        res.json(stats);
    } catch (error) {
        console.error('Error fetching stats:', error);
        // Return default stats if database is unavailable
        res.json({
            totalVisits: 0,
            totalConversions: 0,
            totalCombines: 0,
            totalPdfToWord: 0,
            error: 'Database unavailable'
        });
    }
});

// Middleware to track page visits with MongoDB
app.use(async (req, res, next) => {
    // Only track visits to main pages, not assets
    if (req.path === '/' || req.path.endsWith('.html')) {
        try {
            await trackEvent('visit');
            console.log(`Visit tracked: ${req.path}`);
        } catch (error) {
            console.error('Error tracking visit (non-critical):', error);
            // Continue processing the request even if tracking fails
        }
    }
    next();
});

// Serve static files
app.use(express.static(path.join(__dirname, "frontend")));

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        env: process.env.NODE_ENV || 'development',
        mongodb: process.env.MONGODB_URI ? 'configured' : 'not configured'
    });
});

// Supported formats
const supportedFormats = ["jpg", "png", "tiff", "pdf", "heic", "gif", "bmp", "webp", "avif", "svg"];
const supportedMimetypes = [
    "image/jpg", "image/jpeg", "image/png", "image/tiff", "image/heic", "image/heif",
    "image/gif", "image/bmp", "image/webp", "image/avif", "image/svg+xml"
];

// Simple file conversion endpoint
app.post("/convert", upload.array("files"), async (req, res) => {
    try {
        // Track conversion with MongoDB
        try {
            await trackEvent('conversion');
        } catch (trackError) {
            console.error('Error tracking conversion (non-critical):', trackError);
        }
        
        const format = req.body.output_format?.toLowerCase();
        if (!format || !supportedFormats.includes(format)) {
            return res.status(400).json({ error: `Invalid format. Supported: ${supportedFormats.join(", ")}` });
        }
        
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: "No files uploaded." });
        }

        // For now, just return success to test the endpoint
        const results = req.files.map(file => ({
            original: file.originalname,
            size: file.size,
            format: format
        }));

        // Clean up uploaded files
        req.files.forEach(file => {
            if (fs.existsSync(file.path)) {
                fs.unlinkSync(file.path);
            }
        });

        console.log(`Conversion tracked: ${req.files.length} files to ${format}`);

        res.json({ 
            message: "Conversion endpoint working!",
            files: results,
            format: format
        });

    } catch (error) {
        console.error("Conversion error:", error);
        res.status(500).json({ error: error.message || "Conversion failed" });
    }
});

// Simple combine endpoint
app.post("/combine", upload.array("files"), async (req, res) => {
    try {
        // Track combine with MongoDB
        try {
            await trackEvent('combine');
        } catch (trackError) {
            console.error('Error tracking combine (non-critical):', trackError);
        }
        
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: "No files uploaded." });
        }

        // For now, just return success to test the endpoint
        const results = req.files.map(file => ({
            original: file.originalname,
            size: file.size
        }));

        // Clean up uploaded files
        req.files.forEach(file => {
            if (fs.existsSync(file.path)) {
                fs.unlinkSync(file.path);
            }
        });

        console.log(`Combine tracked: ${req.files.length} files`);

        res.json({ 
            message: "Combine endpoint working!",
            files: results
        });

    } catch (error) {
        console.error("Combine error:", error);
        res.status(500).json({ error: error.message || "Combine failed" });
    }
});

// PDF to Word endpoint
app.post("/pdf-to-word", upload.array("files"), async (req, res) => {
    try {
        // Track PDF to Word conversion with MongoDB
        try {
            await trackEvent('pdfToWord');
        } catch (trackError) {
            console.error('Error tracking PDF to Word (non-critical):', trackError);
        }
        
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: "No files uploaded." });
        }

        // Validate that uploaded files are PDFs
        const pdfFiles = req.files.filter(file => 
            file.mimetype === 'application/pdf' || 
            file.originalname.toLowerCase().endsWith('.pdf')
        );

        if (pdfFiles.length === 0) {
            return res.status(400).json({ error: "No PDF files found. Please upload PDF files only." });
        }

        // For now, just return success to test the endpoint
        const results = pdfFiles.map(file => ({
            original: file.originalname,
            size: file.size,
            outputFormat: 'docx'
        }));

        // Clean up uploaded files
        req.files.forEach(file => {
            if (fs.existsSync(file.path)) {
                fs.unlinkSync(file.path);
            }
        });

        console.log(`PDF to Word tracked: ${pdfFiles.length} files`);

        res.json({ 
            message: "PDF to Word endpoint working!",
            files: results
        });

    } catch (error) {
        console.error("PDF to Word error:", error);
        res.status(500).json({ error: error.message || "PDF to Word conversion failed" });
    }
});

// Main HTML for root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
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
    app.listen(PORT, () => {
        console.log(`Serverless-compatible server running on port ${PORT}`);
    });
}

// Export for serverless
module.exports = app;
