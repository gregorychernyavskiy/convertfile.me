const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

// Configure Sharp for Lambda environment
sharp.cache(false); // Disable cache in Lambda
sharp.simd(false); // Disable SIMD for better compatibility
sharp.concurrency(1); // Single thread in Lambda

/**
 * Process image for Lambda environment with better error handling
 */
async function processImageForLambda(inputBuffer, inputPath, outputFormat = 'jpeg') {
    try {
        console.log('Processing image:', { 
            inputSize: inputBuffer.length, 
            format: outputFormat,
            platform: process.platform 
        });

        let processedBuffer;
        
        if (outputFormat === 'jpeg' || outputFormat === 'jpg') {
            processedBuffer = await sharp(inputBuffer)
                .jpeg({ 
                    quality: 85,
                    progressive: true,
                    mozjpeg: true 
                })
                .toBuffer();
        } else if (outputFormat === 'png') {
            processedBuffer = await sharp(inputBuffer)
                .png({ 
                    compressionLevel: 6,
                    progressive: true 
                })
                .toBuffer();
        } else {
            // Fallback to original buffer if format not supported
            processedBuffer = inputBuffer;
        }

        console.log('Image processed successfully:', { 
            originalSize: inputBuffer.length, 
            processedSize: processedBuffer.length 
        });

        return {
            buffer: processedBuffer,
            isJpeg: outputFormat === 'jpeg' || outputFormat === 'jpg'
        };

    } catch (error) {
        console.error('Image processing error:', error);
        // Return original buffer as fallback
        return {
            buffer: inputBuffer,
            isJpeg: false
        };
    }
}

/**
 * Clean up temporary files in Lambda
 */
function cleanupTempFiles(filePaths) {
    filePaths.forEach(filePath => {
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log('Cleaned up:', filePath);
            }
        } catch (error) {
            console.warn('Cleanup failed for:', filePath, error.message);
        }
    });
}

/**
 * Get file extension safely
 */
function getFileExtension(filename) {
    if (!filename) return '';
    return path.extname(filename).toLowerCase();
}

/**
 * Validate file for Lambda processing
 */
function validateFileForLambda(file) {
    if (!file) return { valid: false, error: 'No file provided' };
    if (!file.originalname) return { valid: false, error: 'No filename provided' };
    if (!file.size || file.size === 0) return { valid: false, error: 'Empty file' };
    if (file.size > 30 * 1024 * 1024) return { valid: false, error: 'File too large (max 30MB)' };
    
    return { valid: true };
}

module.exports = {
    processImageForLambda,
    cleanupTempFiles,
    getFileExtension,
    validateFileForLambda
};
