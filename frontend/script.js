document.addEventListener("DOMContentLoaded", function () {
    let selectedFiles = new Map();
    let taskType = "";

    let selectionButtons = document.getElementById("selectionButtons");
    let fileSection = document.getElementById("fileSection");
    let convertOptions = document.getElementById("convertOptions");
    let combineOptions = document.getElementById("combineOptions");
    let pageTitle = document.getElementById("pageTitle");
    let dropArea = document.querySelector(".drop-area");
    let fileInput = document.getElementById("fileInput");
    let fileList = document.getElementById("fileList");
    let backButton = document.getElementById("backButton");
    let downloadLink = document.getElementById("downloadLink");

    function updateFileCount() {
        document.getElementById("fileCount").textContent = `Files Selected: ${selectedFiles.size}`;
        document.getElementById("pdfFileCount").textContent = `PDFs Selected: ${[...selectedFiles.values()].filter(f => f.type === "application/pdf").length}`;
    }

    function formatFileName(name) {
        return name.length > 30 ? name.substring(0, 28) + "..." : name;
    }
    
    function handleFiles(files) {
        Array.from(files).forEach(file => {
            if (!selectedFiles.has(file.name)) {
                selectedFiles.set(file.name, file);
                let fileItem = document.createElement("div");
                fileItem.className = "file-item";
                fileItem.innerHTML = `${formatFileName(file.name)} <span>(${(file.size / 1024).toFixed(2)} KB)</span>`;
                let removeBtn = document.createElement("button");
                removeBtn.textContent = "Remove";
                removeBtn.onclick = function () {
                    selectedFiles.delete(file.name);
                    fileItem.remove();
                    updateFileCount();
                    checkPDFRequirement();
                };
                fileItem.appendChild(removeBtn);
                fileList.appendChild(fileItem);
            }
        });
        updateFileCount();
        checkPDFRequirement();
    }

    function checkPDFRequirement() {
        let allPDFs = [...selectedFiles.values()].every(file => file.type === "application/pdf");
        document.getElementById("combineOptions").style.display = allPDFs && selectedFiles.size >= 2 ? "block" : "none";
    }

    window.selectTask = function (task) {
        taskType = task;
        selectionButtons.style.display = "none";
        fileSection.style.display = "block";
        backButton.style.display = "block";
        pageTitle.textContent = task === "convert" ? "CONVERT FILES" : "COMBINE TO PDF";
        convertOptions.style.display = task === "convert" ? "block" : "none";
        combineOptions.style.display = task === "combine" ? "block" : "none";
        downloadLink.style.display = "none"; // Hide the download button initially
    };

    window.goBack = function () {
        selectionButtons.style.display = "flex";
        fileSection.style.display = "none";
        backButton.style.display = "none";
        pageTitle.textContent = "Choose Your Selection";
        selectedFiles.clear();
        fileList.innerHTML = "";
        updateFileCount();
        downloadLink.style.display = "none"; // Hide the download link when exiting
    };

    fileInput.addEventListener("change", function (event) {
        handleFiles(event.target.files);
        event.target.value = "";
    });

    dropArea.addEventListener("dragover", function (event) {
        event.preventDefault();
        dropArea.style.background = "#E0F2FE";
        dropArea.style.borderColor = "#2563eb";
    });

    dropArea.addEventListener("dragleave", function () {
        dropArea.style.background = "#F8FAFC";
        dropArea.style.borderColor = "#38BDF8";
    });

    dropArea.addEventListener("drop", function (event) {
        event.preventDefault();
        dropArea.style.background = "#F8FAFC";
        dropArea.style.borderColor = "#38BDF8";
        handleFiles(event.dataTransfer.files);
    });

    window.convertFile = function () {
        if (selectedFiles.size === 0) {
            alert("Please select at least one file.");
            return;
        }

        let formData = new FormData();
        selectedFiles.forEach(file => formData.append("files", file));

        let format = document.getElementById("formatSelect").value;
        formData.append("output_format", format);

        fetch("/convert", {
            method: "POST",
            body: formData
        })
        .then(response => response.blob())
        .then(blob => {
            let url = window.URL.createObjectURL(blob);
            downloadLink.href = url;
            downloadLink.download = `converted_files.${format}`;
            downloadLink.style.display = "block";
            downloadLink.textContent = "Download Converted Files";
        })
        .catch(error => console.error("Error:", error));
    };

    window.combinePDFs = function () {
        if (selectedFiles.size === 0) {
            alert("Please select at least two PDF files.");
            return;
        }

        let allPDFs = [...selectedFiles.values()].every(file => file.type === "application/pdf");
        if (!allPDFs) {
            alert("Only PDF files can be combined.");
            return;
        }

        let formData = new FormData();
        selectedFiles.forEach(file => formData.append("pdfs", file));

        fetch("/combine", {
            method: "POST",
            body: formData
        })
        .then(response => response.blob())
        .then(blob => {
            let url = window.URL.createObjectURL(blob);
            downloadLink.href = url;
            downloadLink.download = "combined.pdf";
            downloadLink.style.display = "block";
            downloadLink.textContent = "Download Combined PDF";
        })
        .catch(error => console.error("Error:", error));
    };
});