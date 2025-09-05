const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { PDFDocument } = require("pdf-lib");

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

// Simple in-memory stats (resets on each serverless function restart)
let stats = {
    totalVisits: 0,
    totalConversions: 0,
    totalCombines: 0,
    totalPdfToWord: 0,
    dailyStats: {}
};

// Middleware to track page visits
app.use(async (req, res, next) => {
    // Only track visits to main pages, not assets
    if (req.path === '/' || req.path.endsWith('.html')) {
        try {
            stats.totalVisits++;
            const today = new Date().toISOString().split('T')[0];
            if (!stats.dailyStats[today]) {
                stats.dailyStats[today] = { visits: 0, conversions: 0, combines: 0, pdfToWord: 0 };
            }
            stats.dailyStats[today].visits++;
            console.log(`Visit tracked: ${req.path}, Total visits: ${stats.totalVisits}`);
        } catch (error) {
            console.error('Error tracking visit:', error);
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
        visits: stats.totalVisits
    });
});

// Stats endpoint with real data
app.get('/api/stats', (req, res) => {
    res.json({
        ...stats,
        lastUpdated: new Date().toISOString(),
        note: 'Stats reset on serverless function restart'
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
        // Track conversion
        stats.totalConversions++;
        const today = new Date().toISOString().split('T')[0];
        if (!stats.dailyStats[today]) {
            stats.dailyStats[today] = { visits: 0, conversions: 0, combines: 0, pdfToWord: 0 };
        }
        stats.dailyStats[today].conversions++;
        
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

        console.log(`Conversion tracked: ${req.files.length} files to ${format}, Total: ${stats.totalConversions}`);

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
        // Track combine
        stats.totalCombines++;
        const today = new Date().toISOString().split('T')[0];
        if (!stats.dailyStats[today]) {
            stats.dailyStats[today] = { visits: 0, conversions: 0, combines: 0, pdfToWord: 0 };
        }
        stats.dailyStats[today].combines++;
        
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

        console.log(`Combine tracked: ${req.files.length} files, Total: ${stats.totalCombines}`);

        res.json({ 
            message: "Combine endpoint working!",
            files: results
        });

    } catch (error) {
        console.error("Combine error:", error);
        res.status(500).json({ error: error.message || "Combine failed" });
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
