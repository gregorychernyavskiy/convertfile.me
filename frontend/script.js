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
                };
                fileItem.appendChild(removeBtn);
                fileList.appendChild(fileItem);
            }
        });
        updateFileCount();
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

    window.convertFile = function (event) {
        // Prevent the form from submitting and reloading the page
        if (event) {
            event.preventDefault();
        }

        if (selectedFiles.size === 0) {
            alert("Please select at least one file.");
            return;
        }

        let format = document.getElementById("formatSelect").value;

        // Check if any file is already in the target format
        let isSameFormat = [...selectedFiles.values()].some(file => {
            let fileExtension = file.name.split('.').pop().toLowerCase();
            return fileExtension === format;
        });

        if (isSameFormat) {
            alert(`You cannot convert a file to the same format (${format}). Please select a different format.`);
            return;
        }

        let formData = new FormData();
        selectedFiles.forEach(file => formData.append("files", file));
        formData.append("output_format", format);

        fetch("http://localhost:3000/convert", {
            method: "POST",
            body: formData
        })
        .then(response => {
            if (!response.ok) {
                return response.json().then(err => {
                    throw new Error(err.error || "Conversion failed.");
                });
            }
            return response.blob();
        })
        .then(blob => {
            let url = window.URL.createObjectURL(blob);
            downloadLink.href = url;
            downloadLink.download = `converted.${format}`;
            downloadLink.style.display = "block";
            downloadLink.textContent = "Download Converted File";
        })
        .catch(error => {
            console.error("Error:", error);
            alert(error.message || "An error occurred during conversion. Please try again.");
        });
    };
});