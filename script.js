document.addEventListener("DOMContentLoaded", function () {
    let selectedFiles = new Map();
    
    // Determine the base API URL
    const getApiBaseUrl = () => {
        // If we're on localhost, use the current port or default to 3000
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            const port = window.location.port || '3000';
            return `http://localhost:${port}`;
        }
        // Otherwise, use the current origin (for serverless deployment)
        return window.location.origin;
    };
    
    const API_BASE_URL = getApiBaseUrl();
    
    // Get elements that exist on current page
    let selectionButtons = document.getElementById("selectionButtons");
    let convertOptions = document.getElementById("convertOptions");
    let combineOptions = document.getElementById("combineOptions");
    let pageTitle = document.getElementById("pageTitle");
    let dropArea = document.querySelector(".drop-area");
    let fileInput = document.getElementById("fileInput");
    let fileList = document.getElementById("fileList");
    let backButton = document.getElementById("backButton");
    let downloadLink = document.getElementById("downloadLink");
    let pdfFileCount = document.getElementById("pdfFileCount");
    
    // Determine what page we're on
    const isConvertPage = convertOptions !== null;
    const isCombinePage = combineOptions !== null;
    const isHomePage = selectionButtons !== null;

    // Load and display stats on home page
    if (isHomePage) {
        loadStats();
    }

    function loadStats() {
        console.log('Loading stats from:', `${API_BASE_URL}/api/stats`);
        fetch(`${API_BASE_URL}/api/stats`)
            .then(response => {
                console.log('Stats response status:', response.status);
                return response.json();
            })
            .then(stats => {
                console.log('Stats data received:', stats);
                updateStatsDisplay(stats);
            })
            .catch(error => {
                console.error('Error loading stats:', error);
                // Set default values on error
                updateStatsDisplay({
                    totalVisits: 0,
                    totalConversions: 0,
                    totalCombines: 0,
                    totalPdfToWord: 0
                });
            });
    }

    function updateStatsDisplay(stats) {
        console.log('Updating stats display with:', stats);
        const elements = {
            totalVisits: document.getElementById('totalVisits'),
            totalConversions: document.getElementById('totalConversions'),
            totalCombines: document.getElementById('totalCombines'),
            totalPdfToWord: document.getElementById('totalPdfToWord')
        };

        console.log('Found elements:', elements);

        // Animate numbers counting up
        Object.keys(elements).forEach(key => {
            if (elements[key]) {
                console.log(`Animating ${key} from 0 to ${stats[key] || 0}`);
                animateNumber(elements[key], 0, stats[key] || 0, 1500);
            } else {
                console.warn(`Element not found: ${key}`);
            }
        });
    }

    function animateNumber(element, start, end, duration) {
        if (start === end) {
            element.textContent = end.toLocaleString();
            return;
        }
        
        const range = end - start;
        const startTime = Date.now();
        
        const timer = setInterval(() => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            
            // Easing function for smooth animation
            const easeOutCubic = 1 - Math.pow(1 - progress, 3);
            const current = Math.round(start + (range * easeOutCubic));
            
            element.textContent = current.toLocaleString();
            
            if (progress >= 1) {
                clearInterval(timer);
                element.textContent = end.toLocaleString();
            }
        }, 16); // 60fps
    }

    function updateFileCount() {
        const fileCountElement = document.getElementById("fileCount");
        if (fileCountElement) {
            fileCountElement.textContent = `Files Selected: ${selectedFiles.size}`;
        }
        if (pdfFileCount) {
            pdfFileCount.textContent = `PDFs Selected: ${Array.from(selectedFiles.values()).filter(file => file.name.endsWith('.pdf')).length}`;
        }
    }

    function formatFileName(name) {
        return name.length > 30 ? name.substring(0, 28) + "..." : name;
    }

    function handleFiles(files) {
        // Check if adding new files will exceed the limit of 3
        if (selectedFiles.size + files.length > 10) {
            alert("You can only select a maximum of 10 files.");
            return;
        }

        // Add files to the selectedFiles map
        Array.from(files).forEach(file => {
            if (!selectedFiles.has(file.name)) {
                selectedFiles.set(file.name, file);
            }
        });
        renderFileList();
        updateFileCount();
    }

    function renderFileList() {
        if (!fileList) return;
        fileList.innerHTML = "";
        if (selectedFiles.size === 0) return;
        
        // If on convert page, show numbered list for file selection
        if (isConvertPage) {
            let selectedFileName = window.selectedFileName || Array.from(selectedFiles.keys())[0];
            Array.from(selectedFiles.values()).forEach((file, index) => {
                let fileItem = document.createElement("div");
                fileItem.className = "file-item";
                fileItem.style.display = "flex";
                fileItem.style.alignItems = "center";
                fileItem.style.gap = "12px";
                fileItem.style.cursor = "pointer";
                fileItem.style.padding = "8px";
                fileItem.style.borderRadius = "6px";
                fileItem.style.transition = "background-color 0.2s";
                
                // No background styling - clean look
                fileItem.style.backgroundColor = "transparent";
                
                // Number instead of radio button
                let numberSpan = document.createElement("span");
                numberSpan.textContent = (index + 1).toString();
                numberSpan.style.backgroundColor = file.name === selectedFileName ? "#38BDF8" : "#94A3B8";
                numberSpan.style.color = "white";
                numberSpan.style.borderRadius = "50%";
                numberSpan.style.width = "24px";
                numberSpan.style.height = "24px";
                numberSpan.style.display = "flex";
                numberSpan.style.alignItems = "center";
                numberSpan.style.justifyContent = "center";
                numberSpan.style.fontSize = "14px";
                numberSpan.style.fontWeight = "bold";
                numberSpan.style.minWidth = "24px";
                
                // Make the entire item clickable for selection
                fileItem.onclick = function () {
                    window.selectedFileName = file.name;
                    renderFileList(); // Re-render to update styling
                };
                
                fileItem.appendChild(numberSpan);
                
                // File name and size
                let fileLabel = document.createElement("span");
                fileLabel.textContent = `${formatFileName(file.name)} (${(file.size / 1024).toFixed(2)} KB)`;
                fileLabel.style.flex = "1";
                fileItem.appendChild(fileLabel);
                
                // Remove button
                let removeBtn = document.createElement("button");
                removeBtn.textContent = "Remove";
                removeBtn.style.marginLeft = "auto";
                removeBtn.onclick = function (e) {
                    e.stopPropagation(); // Prevent triggering the file selection
                    selectedFiles.delete(file.name);
                    if (window.selectedFileName === file.name) window.selectedFileName = null;
                    renderFileList();
                    updateFileCount();
                };
                fileItem.appendChild(removeBtn);
                fileList.appendChild(fileItem);
            });
        } else if (isCombinePage) {
            // On combine page, just show list with remove buttons (no radio buttons)
            Array.from(selectedFiles.values()).forEach(file => {
                let fileItem = document.createElement("div");
                fileItem.className = "file-item";
                fileItem.style.display = "flex";
                fileItem.style.alignItems = "center";
                fileItem.style.gap = "12px";
                
                // File name and size
                let fileLabel = document.createElement("span");
                fileLabel.textContent = `${formatFileName(file.name)} (${(file.size / 1024).toFixed(2)} KB)`;
                fileItem.appendChild(fileLabel);
                
                // Remove button
                let removeBtn = document.createElement("button");
                removeBtn.textContent = "Remove";
                removeBtn.onclick = function () {
                    selectedFiles.delete(file.name);
                    renderFileList();
                    updateFileCount();
                };
                fileItem.appendChild(removeBtn);
                fileList.appendChild(fileItem);
            });
        }
    }

    // Only add event listeners if elements exist on this page
    if (fileInput) {
        fileInput.addEventListener("change", function (event) {
            handleFiles(event.target.files);
            event.target.value = "";
        });
    }

    if (dropArea) {
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
    }

    window.convertFile = function (event) {
        event.preventDefault();
        if (selectedFiles.size === 0) {
            alert("Please select at least one file.");
            return;
        }
        
        const formatSelect = document.getElementById("formatSelect");
        if (!formatSelect) {
            alert("Format selector not found.");
            return;
        }
        
        const format = formatSelect.value;
        let formData = new FormData();
        
        // Only send the selected file
        const selectedName = window.selectedFileName || Array.from(selectedFiles.keys())[0];
        const selectedFile = selectedFiles.get(selectedName);
        
        if (!selectedFile) {
            alert("Please select a file to convert.");
            return;
        }
        
        formData.append("files", selectedFile);
        formData.append("output_format", format);
        
        // Show loading state
        const convertBtn = document.querySelector('button[type="submit"]');
        if (convertBtn) {
            convertBtn.textContent = "Converting...";
            convertBtn.disabled = true;
        }
        
        fetch(`${API_BASE_URL}/convert`, {
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
            const url = window.URL.createObjectURL(blob);
            const originalName = selectedFile.name;
            const nameWithoutExt = originalName.substring(0, originalName.lastIndexOf('.')) || originalName;
            const downloadName = `${nameWithoutExt}.${format}`;
            
            if (downloadLink) {
                downloadLink.href = url;
                downloadLink.download = downloadName;
                downloadLink.style.display = "block";
                downloadLink.textContent = `Download ${downloadName}`;
            }
            
            // Reset button
            if (convertBtn) {
                convertBtn.textContent = "Convert";
                convertBtn.disabled = false;
            }
        })
        .catch(error => {
            console.error('Conversion error:', error);
            alert(error.message);
            
            // Reset button
            if (convertBtn) {
                convertBtn.textContent = "Convert";
                convertBtn.disabled = false;
            }
        });
    };

    window.combinePDFs = function () {
        if (selectedFiles.size === 0) {
            alert("Please select at least one file.");
            return;
        }

        // Check if all selected files are supported formats (PDFs or images)
        const supportedExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.tiff', '.heic', '.heif', '.gif', '.bmp', '.webp', '.avif', '.svg'];
        const unsupportedFiles = Array.from(selectedFiles.values()).filter(file => {
            const ext = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
            return !supportedExtensions.includes(ext);
        });
        
        if (unsupportedFiles.length > 0) {
            alert("Please select only supported file types (PDF, JPG, PNG, TIFF, HEIC, GIF, BMP, WEBP, AVIF, SVG).");
            return;
        }

        let formData = new FormData();
        selectedFiles.forEach(file => formData.append("files", file));

        // Show loading state
        const combineBtn = document.querySelector('button[onclick="combinePDFs()"]');
        if (combineBtn) {
            combineBtn.textContent = "Combining...";
            combineBtn.disabled = true;
        }

        fetch(`${API_BASE_URL}/combine`, {
            method: "POST",
            body: formData
        })
        .then(response => {
            if (!response.ok) {
                return response.json().then(err => {
                    throw new Error(err.error || "Combination failed.");
                });
            }
            return response.blob();
        })
        .then(blob => {
            let url = window.URL.createObjectURL(blob);
            const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
            const downloadName = `combined_${timestamp}.pdf`;
            
            if (downloadLink) {
                downloadLink.href = url;
                downloadLink.download = downloadName;
                downloadLink.style.display = "block";
                downloadLink.textContent = `Download ${downloadName}`;
            }

            // Clear selected files and reset the file list
            selectedFiles.clear();
            if (fileList) fileList.innerHTML = "";
            updateFileCount();
            
            // Reset button
            if (combineBtn) {
                combineBtn.textContent = "Combine to PDF";
                combineBtn.disabled = false;
            }
        })
        .catch(error => {
            console.error("Combine error:", error);
            alert(error.message || "An error occurred during combination. Please try again.");
            
            // Reset button
            if (combineBtn) {
                combineBtn.textContent = "Combine to PDF";
                combineBtn.disabled = false;
            }
        });
    };

    // PDF to Word conversion function
    window.convertPdfToWord = function (event) {
        event.preventDefault();
        if (selectedFiles.size === 0) {
            alert("Please select at least one PDF file.");
            return;
        }
        
        const formatSelect = document.getElementById("formatSelect");
        if (!formatSelect) {
            alert("Format selector not found.");
            return;
        }
        
        const format = formatSelect.value;
        let formData = new FormData();
        
        // Add all PDF files for conversion
        selectedFiles.forEach(file => {
            if (file.type === "application/pdf" || file.name.toLowerCase().endsWith('.pdf')) {
                formData.append("files", file);
            }
        });
        
        formData.append("output_format", format);
        
        // Show loading state
        const convertBtn = document.querySelector('button[type="submit"]');
        if (convertBtn) {
            convertBtn.textContent = "Converting to Word...";
            convertBtn.disabled = true;
        }
        
        fetch(`${API_BASE_URL}/pdf-to-word`, {
            method: "POST",
            body: formData
        })
        .then(response => {
            if (!response.ok) {
                return response.json().then(err => {
                    throw new Error(err.error || "PDF to Word conversion failed.");
                });
            }
            return response.blob();
        })
        .then(blob => {
            const url = window.URL.createObjectURL(blob);
            const fileName = selectedFiles.size === 1 
                ? Array.from(selectedFiles.values())[0].name.replace(/\.[^/.]+$/, "") + "." + format
                : "converted_files." + (format === "docx" ? "zip" : format);
                
            const downloadLink = document.getElementById("downloadLink");
            if (downloadLink) {
                downloadLink.href = url;
                downloadLink.download = fileName;
                downloadLink.textContent = "Download Converted File";
                downloadLink.style.display = "block";
                downloadLink.click();
            }
            
            // Reset button
            if (convertBtn) {
                convertBtn.textContent = "Convert to Word";
                convertBtn.disabled = false;
            }
        })
        .catch(error => {
            console.error("PDF to Word conversion error:", error);
            alert(error.message || "An error occurred during PDF to Word conversion. Please try again.");
            
            // Reset button
            if (convertBtn) {
                convertBtn.textContent = "Convert to Word";
                convertBtn.disabled = false;
            }
        });
    };
});