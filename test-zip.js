const fs = require('fs');
const path = require('path');

// Import the compatibleZip function
const { createCompatibleZip } = require('./backend/utils/compatibleZip.js');

async function testZipCreation() {
    try {
        // Read test files
        const file1 = fs.readFileSync('/tmp/proper-test.png');
        const file2 = fs.readFileSync('/tmp/proper-test2.png');
        
        console.log('Test files loaded:', {
            file1Size: file1.length,
            file2Size: file2.length
        });
        
        const files = [
            { buffer: file1, name: 'test1.png' },
            { buffer: file2, name: 'test2.png' }
        ];
        
        const outputPath = '/tmp/test-zip-output.zip';
        
        console.log('Creating ZIP...');
        await createCompatibleZip({ outputPath, files });
        
        console.log('ZIP created successfully!');
        
        // Test extraction
        const { exec } = require('child_process');
        exec(`cd /tmp && mkdir -p zip_test_extract && cd zip_test_extract && unzip -l ../test-zip-output.zip`, (error, stdout, stderr) => {
            if (error) {
                console.error('Extraction test failed:', error);
                console.error('stderr:', stderr);
            } else {
                console.log('Extraction test successful:');
                console.log(stdout);
            }
        });
        
    } catch (error) {
        console.error('ZIP test failed:', error);
    }
}

testZipCreation();
