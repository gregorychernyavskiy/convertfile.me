const fs = require('fs');

/**
 * Creates a ZIP file using JSZip with enhanced Lambda compatibility
 * @param {Object} options - Configuration options
 * @param {string} options.outputPath - Path where ZIP file will be created
 * @param {Array} options.files - Array of files to add {buffer, name}
 */
function createCompatibleZip(options) {
    return new Promise((resolve, reject) => {
        const { outputPath, files } = options;
        
        try {
            console.log(`Creating ZIP with ${files.length} files at ${outputPath}`);
            
            const JSZip = require('jszip');
            const zip = new JSZip();
            
            let filesAdded = 0;
            
            // Process files synchronously to avoid buffer corruption
            for (let index = 0; index < files.length; index++) {
                const file = files[index];
                
                if (!file || !file.buffer || !file.name) {
                    console.warn(`Invalid file data at index ${index}:`, { hasBuffer: !!file?.buffer, hasName: !!file?.name });
                    continue;
                }
                
                let buffer;
                try {
                    // Ensure we have a proper Buffer
                    if (Buffer.isBuffer(file.buffer)) {
                        buffer = file.buffer;
                    } else if (typeof file.buffer === 'string') {
                        buffer = Buffer.from(file.buffer, 'binary');
                    } else if (file.buffer instanceof Uint8Array) {
                        buffer = Buffer.from(file.buffer);
                    } else {
                        buffer = Buffer.from(file.buffer);
                    }
                } catch (bufferError) {
                    console.error(`Failed to create buffer for ${file.name}:`, bufferError);
                    continue;
                }
                
                if (!buffer || buffer.length === 0) {
                    console.warn(`Skipping empty file: ${file.name}`);
                    continue;
                }
                
                // Sanitize filename for better compatibility
                const safeName = file.name.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_');
                
                // Add buffer to ZIP with explicit binary type
                zip.file(safeName, buffer, {
                    binary: true,
                    createFolders: false,
                    date: new Date(),
                    compression: 'STORE' // No compression for maximum compatibility
                });
                
                filesAdded++;
                console.log(`Added file ${index + 1}/${files.length}: ${safeName} (${buffer.length} bytes)`);
            }
            
            console.log(`Added ${filesAdded} files to ZIP archive`);
            
            if (filesAdded === 0) {
                reject(new Error('No valid files to add to ZIP archive'));
                return;
            }
            
            // Generate ZIP with maximum compatibility settings
            const generateOptions = {
                type: 'nodebuffer',
                compression: 'STORE', // No compression
                compressionOptions: {
                    level: 0
                },
                platform: 'UNIX',
                comment: 'ConvertFile.me',
                streamFiles: false, // Disable streaming for better compatibility
                mimeType: 'application/zip'
            };
            
            console.log('Generating ZIP buffer...');
            
            zip.generateAsync(generateOptions)
                .then((zipBuffer) => {
                    console.log(`ZIP buffer generated: ${zipBuffer.length} bytes`);
                    
                    // Write buffer to file synchronously for better reliability
                    try {
                        fs.writeFileSync(outputPath, zipBuffer);
                        console.log(`ZIP written to file: ${outputPath}`);
                        
                        // Verify the written file
                        const stats = fs.statSync(outputPath);
                        console.log(`ZIP file verification: ${stats.size} bytes on disk`);
                        
                        if (stats.size === zipBuffer.length && stats.size > 0) {
                            console.log('ZIP file verification successful');
                            resolve(outputPath);
                        } else {
                            console.error(`ZIP file verification failed: expected ${zipBuffer.length}, got ${stats.size}`);
                            reject(new Error('ZIP file verification failed'));
                        }
                    } catch (writeError) {
                        console.error('Failed to write ZIP file:', writeError);
                        reject(writeError);
                    }
                })
                .catch((zipError) => {
                    console.error('ZIP generation error:', zipError);
                    reject(zipError);
                });
            
        } catch (error) {
            console.error('ZIP creation error:', error);
            reject(error);
        }
    });
}

module.exports = { createCompatibleZip };
