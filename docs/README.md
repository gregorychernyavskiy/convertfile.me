# ConvertFile.me - Universal File Converter

A powerful, serverless file conversion platform that supports image conversion, PDF creation, file combining, and PDF to Word conversion.

## Features

- **Image Conversion**: Convert between JPG, PNG, TIFF, HEIC, GIF, BMP, WEBP, AVIF, SVG formats
- **PDF Creation**: Convert images to PDF
- **File Combining**: Combine multiple images and PDFs into a single PDF
- **PDF to Word**: Convert PDF files to DOCX format
- **Real-time Statistics**: Track usage with MongoDB integration
- **User Activity Logging**: Detailed analytics and monitoring

## Technology Stack

- **Backend**: Node.js + Express
- **Image Processing**: Sharp.js
- **PDF Handling**: pdf-lib, pdf-parse
- **Word Documents**: docx library
- **Database**: MongoDB
- **Deployment**: Vercel (serverless)

## Local Development

### Prerequisites

- Node.js 18+
- npm or yarn
- MongoDB (local or Atlas)

### Setup

1. Clone the repository:
```bash
git clone <repository-url>
cd convertfile.me
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
```bash
cp .env.example .env
```

Edit `.env` and add your MongoDB connection string:
```env
MONGODB_URI=your_mongodb_connection_string_here
PORT=3000
NODE_ENV=development
```

**Note**: Replace `your_mongodb_connection_string_here` with your actual MongoDB Atlas connection string.

4. Start the development server:
```bash
npm start
```

The server will be available at `http://localhost:3000`

## Deployment

### Vercel Deployment

1. Install Vercel CLI:
```bash
npm i -g vercel
```

2. Set up environment variables in Vercel:
```bash
vercel env add MONGODB_URI
```

3. Deploy:
```bash
vercel --prod
```

### Environment Variables

Required environment variables for production:

- `MONGODB_URI`: MongoDB connection string
- `NODE_ENV`: Set to "production" for production deployment

## API Endpoints

### File Conversion
- `POST /convert` - Convert files between formats
- `POST /combine` - Combine multiple files into a PDF
- `POST /pdf-to-word` - Convert PDF to Word documents

### Statistics
- `GET /api/stats` - Get usage statistics
- `GET /api/health` - Health check endpoint

## Supported File Formats

### Input Formats
- Images: JPG, PNG, TIFF, HEIC, GIF, BMP, WEBP, AVIF, SVG
- Documents: PDF

### Output Formats
- Images: JPG, PNG, TIFF, GIF, BMP, WEBP, AVIF
- Documents: PDF, DOCX

## File Size Limits

- Maximum file size: 50MB per file
- Maximum files per request: 10 files

## Troubleshooting

### Common Issues

1. **Conversion fails with errors**
   - Ensure all dependencies are installed: `npm install`
   - Check file format is supported
   - Verify file size is under 50MB

2. **Database connection issues**
   - Verify `MONGODB_URI` is correctly set
   - Check network connectivity to MongoDB
   - Ensure database user has proper permissions

3. **File upload errors**
   - Check file size limits (50MB max)
   - Verify file format is supported
   - Ensure proper CORS headers

4. **Memory issues on Vercel**
   - Large files may exceed serverless function memory limits
   - Consider implementing file streaming for large files

### Debug Mode

Enable debug logging by setting:
```env
DEBUG=true
```

## Performance Optimization

- Images are processed using Sharp (high-performance)
- Database connections are pooled and reused
- Files are automatically cleaned up after processing
- Serverless functions have optimized cold start times

## Security

- File type validation on upload
- Size limits enforced
- Input sanitization for filenames
- No persistent file storage (automatic cleanup)
