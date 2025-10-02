const archiver = require('archiver');
const fs = require('fs');

/**
 * Creates a ZIP file with better error handling and compatibility
 * @param {Object} options - Configuration options
 * @param {string} options.outputPath - Path where ZIP file will be created
 * @param {Array} options.files - Array of files to add {buffer, name}
 */
function createCompatibleZip(options) {
    return new Promise((resolve, reject) => {
        const { outputPath, files } = options;
        
        // Use more conservative archiver settings for better compatibility
        const archive = archiver('zip', {
            zlib: { level: 6 }, // Moderate compression
            forceLocalTime: true,
            store: false
        });
        
        const output = fs.createWriteStream(outputPath);
        
        // Better error handling
        let isFinalized = false;
        let hasError = false;
        
        output.on('close', () => {
            if (!hasError && isFinalized) {
                console.log(`ZIP created successfully: ${archive.pointer()} bytes`);
                resolve(outputPath);
            }
        });
        
        output.on('error', (err) => {
            hasError = true;
            console.error('Output stream error:', err);
            reject(err);
        });
        
        archive.on('error', (err) => {
            hasError = true;
            console.error('Archive error:', err);
            reject(err);
        });
        
        archive.on('warning', (err) => {
            if (err.code === 'ENOENT') {
                console.warn('Archive warning (non-critical):', err.message);
            } else {
                hasError = true;
                reject(err);
            }
        });
        
        archive.on('end', () => {
            console.log('Archive finalized successfully');
            isFinalized = true;
        });
        
        // Pipe archive data to the file
        archive.pipe(output);
        
        // Add files to archive
        files.forEach(file => {
            if (file.buffer && file.name) {
                // Ensure we have a proper Buffer
                const buffer = Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.buffer);
                
                if (buffer.length > 0) {
                    archive.append(buffer, { 
                        name: file.name,
                        date: new Date()
                    });
                } else {
                    console.warn(`Skipping empty file: ${file.name}`);
                }
            }
        });
        
        // Important: Finalize the archive (this must be called!)
        archive.finalize().catch(reject);
    });
}

module.exports = { createCompatibleZip };
