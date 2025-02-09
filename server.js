const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const cors = require("cors");

// Initialize Express app
const app = express();
const upload = multer({ dest: "uploads/" });

// Enable CORS
app.use(cors());

// Serve static files from the "frontend" folder
app.use(express.static(path.join(__dirname, "frontend")));

// Middleware to parse form data correctly
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

// Supported formats
const supportedFormats = ["jpg", "png", "tiff"];

// Convert file endpoint
app.post("/convert", upload.array("files"), async (req, res) => {
    try {
        const format = req.body.output_format.toLowerCase();
        if (!format || !supportedFormats.includes(format)) {
            console.error("Invalid format received:", format);
            return res.status(400).json({ error: `Invalid format. Supported formats: ${supportedFormats.join(", ")}.` });
        }

        console.log("Received files:", req.files);

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: "No files uploaded." });
        }

        const convertedFiles = [];

        for (let file of req.files) {
            const inputPath = file.path;
            const outputPath = path.join(uploadsDir, `${file.filename}.${format}`);

            console.log(`Processing file: ${inputPath} -> ${outputPath}`);

            try {
                // Validate file type
                if (!["image/jpg", "image/jpeg", "image/png", "image/tiff"].includes(file.mimetype)) {
                    throw new Error("Invalid file type. Only JPG, PNG, and TIFF files are supported.");
                }

                // Convert the image using sharp
                const sharpInstance = sharp(inputPath);

                // Special handling for TIFF format
                if (format === "tiff") {
                    await sharpInstance
                        .tiff({
                            compression: "lzw", // Use LZW compression for TIFF
                            quality: 100,       // Adjust quality if needed
                        })
                        .toFile(outputPath);
                }
                // Handle other formats (JPG, PNG, etc.)
                else {
                    await sharpInstance
                        .toFormat(format)
                        .toFile(outputPath);
                }

                if (fs.existsSync(outputPath)) {
                    console.log("File conversion successful:", outputPath);
                    convertedFiles.push(outputPath);
                } else {
                    throw new Error("Output file not found after conversion.");
                }

            } catch (sharpError) {
                console.error("Sharp conversion error:", sharpError);
                return res.status(500).json({ error: sharpError.message || "Image processing failed." });
            } finally {
                // Clean up the original uploaded file
                if (fs.existsSync(inputPath)) {
                    fs.unlinkSync(inputPath);
                }
            }
        }

        if (convertedFiles.length === 1) {
            console.log("Sending converted file to client:", convertedFiles[0]);
            res.download(convertedFiles[0], `converted.${format}`, (err) => {
                if (err) {
                    console.error("Error sending file:", err);
                    res.status(500).json({ error: "Error sending file." });
                } else {
                    console.log("File sent successfully.");
                }
                // Clean up the converted file after sending
                if (fs.existsSync(convertedFiles[0])) {
                    fs.unlinkSync(convertedFiles[0]);
                }
            });
        } else {
            res.json({ message: "Multiple files converted.", files: convertedFiles });
            // Clean up all converted files after sending
            convertedFiles.forEach(file => {
                if (fs.existsSync(file)) {
                    fs.unlinkSync(file);
                }
            });
        }
    } catch (error) {
        console.error("Conversion Error:", error);
        res.status(500).json({ error: error.message || "Conversion failed. Please try again." });
    }
});

// Start the server
app.listen(3000, () => {
    console.log("Server running on http://localhost:3000");
});