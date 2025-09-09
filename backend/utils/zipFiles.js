const archiver = require('archiver');
module.exports = function zipFiles(files, outputPath) {
    return new Promise((resolve, reject) => {
        const output = require('fs').createWriteStream(outputPath);
        const archive = archiver('zip', { zlib: { level: 9 } });
        output.on('close', () => resolve());
        archive.on('error', err => reject(err));
        archive.pipe(output);
        files.forEach(file => {
            archive.file(file, { name: require('path').basename(file) });
        });
        archive.finalize();
    });
};
