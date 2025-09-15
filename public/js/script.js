document.addEventListener("DOMContentLoaded", function () {
    let selectedFiles = new Map();
    
    // Orientation handling for mobile devices
    function handleOrientationChange() {
        const orientationSuggestion = document.getElementById('orientationSuggestion');
        if (!orientationSuggestion) return;

        // Check if it's a mobile device and in portrait mode
        const isMobile = window.innerWidth <= 768 && window.innerHeight <= 1024;
        const isPortrait = window.innerHeight > window.innerWidth;
        const hasBeenDismissed = localStorage.getItem('orientationSuggestionDismissed') === 'true';
        
        // Additional check for touch capability (mobile/tablet)
        const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

        if (isMobile && isPortrait && isTouchDevice && !hasBeenDismissed) {
            orientationSuggestion.classList.remove('hidden');
        } else {
            orientationSuggestion.classList.add('hidden');
        }
    }

    // Function to hide orientation suggestion
    window.hideOrientationSuggestion = function() {
        const orientationSuggestion = document.getElementById('orientationSuggestion');
        if (orientationSuggestion) {
            orientationSuggestion.classList.add('hidden');
            localStorage.setItem('orientationSuggestionDismissed', 'true');
        }
    };

    // Function to suggest rotation (simple version)
    window.suggestRotation = function() {
        // Try to force landscape orientation
        forceLandscapeOrientation();
    };

    // Function to force landscape orientation using multiple methods
    function forceLandscapeOrientation() {
        // Method 1: Screen Orientation API
        if (screen.orientation && screen.orientation.lock) {
            try {
                screen.orientation.lock('landscape-primary').catch(() => {
                    screen.orientation.lock('landscape').catch(() => {
                        console.log('Screen orientation lock not supported');
                    });
                });
            } catch (e) {
                console.log('Screen orientation API error:', e);
            }
        }
        
        // Method 2: Fullscreen API (helps on some devices)
        if (document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen().then(() => {
                // Try to lock orientation after entering fullscreen
                if (screen.orientation && screen.orientation.lock) {
                    screen.orientation.lock('landscape').catch(() => {});
                }
            }).catch(() => {
                console.log('Fullscreen not supported or denied');
            });
        }
        
        // Method 3: Add CSS that encourages landscape (visual cue)
        document.body.style.transform = 'rotate(90deg)';
        document.body.style.transformOrigin = 'center center';
        document.body.style.width = '100vh';
        document.body.style.height = '100vw';
        
        // Reset the CSS rotation after 2 seconds (just a visual hint)
        setTimeout(() => {
            document.body.style.transform = '';
            document.body.style.transformOrigin = '';
            document.body.style.width = '';
            document.body.style.height = '';
        }, 2000);
    }

    // Check orientation on load and when orientation changes
    handleOrientationChange();
    window.addEventListener('orientationchange', function() {
        setTimeout(handleOrientationChange, 100); // Small delay to ensure orientation has changed
    });
    window.addEventListener('resize', handleOrientationChange);
    
    // Determine the base API URL
    const getApiBaseUrl = () => {
        // If we're on localhost, always target API on port 3000 (backend dev server)
        // This avoids using whatever port the static server runs on (e.g., Live Server on 3001)
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            return 'http://localhost:3000';
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
                    totalPdfToWord: 0,
                    totalPdfToImages: 0
                });
            });
    }

    function updateStatsDisplay(stats) {
        console.log('Updating stats display with:', stats);
        const elements = {
            totalVisits: document.getElementById('totalVisits'),
            totalConversions: document.getElementById('totalConversions'),
            totalCombines: document.getElementById('totalCombines'),
            totalPdfToWord: document.getElementById('totalPdfToWord'),
            totalPdfToImages: document.getElementById('totalPdfToImages')
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
        // Check if adding new files will exceed the limit of 10
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
        
        // Show all files with remove buttons (no more selection needed)
        Array.from(selectedFiles.values()).forEach((file, index) => {
            let fileItem = document.createElement("div");
            fileItem.className = "file-item";
            fileItem.style.display = "flex";
            fileItem.style.alignItems = "center";
            fileItem.style.gap = "12px";
            fileItem.style.padding = "8px";
            fileItem.style.borderRadius = "6px";
            fileItem.style.backgroundColor = "transparent";
            
            // Number indicator
            let numberSpan = document.createElement("span");
            numberSpan.textContent = (index + 1).toString();
            numberSpan.style.backgroundColor = "#38BDF8";
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
            removeBtn.onclick = function () {
                selectedFiles.delete(file.name);
                renderFileList();
                updateFileCount();
            };
            fileItem.appendChild(removeBtn);
            fileList.appendChild(fileItem);
        });
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
        
        // Send ALL selected files for conversion
        selectedFiles.forEach(file => {
            formData.append("files", file);
        });
        formData.append("output_format", format);
        
        // Show loading state
        const convertBtn = document.querySelector('button[type="submit"]');
        if (convertBtn) {
            convertBtn.textContent = selectedFiles.size === 1 ? "Converting..." : "Converting & Zipping...";
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
            let downloadName;
            
            if (selectedFiles.size === 1) {
                // Single file - use original name with new extension
                const originalFile = Array.from(selectedFiles.values())[0];
                const nameWithoutExt = originalFile.name.substring(0, originalFile.name.lastIndexOf('.')) || originalFile.name;
                downloadName = `${nameWithoutExt}.${format}`;
            } else {
                // Multiple files - ZIP file
                const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
                downloadName = `converted_files_${timestamp}.zip`;
            }
            
            if (downloadLink) {
                downloadLink.href = url;
                downloadLink.download = downloadName;
                downloadLink.style.display = "block";
                downloadLink.textContent = `Download ${downloadName}`;
                
                // Auto-download the file
                downloadLink.click();
            }
            
            // Clear selected files and reset the file list after successful conversion
            selectedFiles.clear();
            if (fileList) fileList.innerHTML = "";
            updateFileCount();
            
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

    // PDF to Images conversion function
    window.convertPdfToImages = function (event) {
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
            convertBtn.textContent = "Converting to Images...";
            convertBtn.disabled = true;
        }
        
        fetch(`${API_BASE_URL}/pdf-to-images`, {
            method: "POST",
            body: formData
        })
        .then(response => {
            if (!response.ok) {
                return response.json().then(err => {
                    throw new Error(err.error || "PDF to Images conversion failed.");
                });
            }
            return response.blob();
        })
        .then(blob => {
            const url = window.URL.createObjectURL(blob);
            const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
            const fileName = selectedFiles.size === 1 
                ? Array.from(selectedFiles.values())[0].name.replace(/\.[^/.]+$/, "") + "_images.zip"
                : `pdf_to_images_${timestamp}.zip`;
                
            const downloadLink = document.getElementById("downloadLink");
            if (downloadLink) {
                downloadLink.href = url;
                downloadLink.download = fileName;
                downloadLink.textContent = "Download Images";
                downloadLink.style.display = "block";
                downloadLink.click();
            }
            
            // Clear selected files and reset the file list after successful conversion
            selectedFiles.clear();
            if (fileList) fileList.innerHTML = "";
            updateFileCount();
            
            // Reset button
            if (convertBtn) {
                convertBtn.textContent = "Convert to Images";
                convertBtn.disabled = false;
            }
        })
        .catch(error => {
            console.error("PDF to Images conversion error:", error);
            alert(error.message || "An error occurred during PDF to Images conversion. Please try again.");
            
            // Reset button
            if (convertBtn) {
                convertBtn.textContent = "Convert to Images";
                convertBtn.disabled = false;
            }
        });
    };
});