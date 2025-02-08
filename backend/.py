from flask import Flask, request, send_file
import os
from PIL import Image

app = Flask(__name__)

UPLOAD_FOLDER = "uploads"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

@app.route("/convert", methods=["POST"])
def convert():
    file = request.files["file"]
    if not file:
        return {"error": "No file uploaded"}, 400

    filename = file.filename
    filepath = os.path.join(UPLOAD_FOLDER, filename)
    file.save(filepath)

    output_file = convert_to_jpeg(filepath)
    
    return send_file(output_file, as_attachment=True)

def convert_to_jpeg(filepath):
    """ Convert PNG to JPEG """
    filename, ext = os.path.splitext(filepath)
    output_path = f"{filename}.jpg"

    if ext.lower() == ".png":
        img = Image.open(filepath)

        # Convert RGBA (with transparency) to RGB to avoid errors
        if img.mode == "RGBA":
            img = img.convert("RGB")

        img.save(output_path, "JPEG")

    return output_path

if __name__ == "__main__":
    app.run(debug=True)