/*! rasterizeHTML.js - v0.1.0 - 2012-11-17
* http://www.github.com/cburgmer/rasterizeHTML.js
* Copyright (c) 2012 Christoph Burgmer; Licensed MIT */

var rasterizeHTML = (function (window, URI, CSSParser) {
    "use strict";

    var module = {};

    /* Utilities */

    var uniqueIdList = [];

    module.util = {};

    module.util.getConstantUniqueIdFor = function (element) {
        // HACK, using a list results in O(n), but how do we hash e.g. a DOM node?
        if (uniqueIdList.indexOf(element) < 0) {
            uniqueIdList.push(element);
        }
        return uniqueIdList.indexOf(element);
    };

    module.util.cloneArray = function (nodeList) {
        return Array.prototype.slice.apply(nodeList, [0]);
    };

    module.util.log = function (msg) {
        if (window.console && window.console.log) {
            window.console.log(msg);
        }
    };

    module.util.joinUrl = function (baseUrl, url) {
        var theUrl = new URI(url);
        if (theUrl.is("relative")) {
            theUrl = theUrl.absoluteTo(baseUrl);
        }
        return theUrl.toString();
    };

    module.util.isDataUri = function (url) {
        return (/^data:/).test(url);
    };

    module.util.map = function (list, func, callback) {
        var completedCount = 0,
            // Operating inline on array-like structures like document.getElementByTagName() (e.g. deleting a node),
            // will change the original list
            clonedList = module.util.cloneArray(list),
            results = [],
            i;

        if (clonedList.length === 0) {
            callback(results);
        }

        var callForItem = function (idx) {
            function funcFinishCallback(result) {
                completedCount += 1;

                results[idx] = result;

                if (completedCount === clonedList.length) {
                    callback(results);
                }
            }

            func(clonedList[idx], funcFinishCallback);
        };

        for(i = 0; i < clonedList.length; i++) {
            callForItem(i);
        }
    };

    var getUncachableURL = function (url) {
        return url + "?_=" + Date.now();
    };

    module.util.ajax = function (url, options, successCallback, errorCallback) {
        var ajaxRequest = new window.XMLHttpRequest(),
            augmentedUrl;

        options = options || {};
        augmentedUrl = options.cache === false ? getUncachableURL(url) : url;

        ajaxRequest.addEventListener("load", function () {
            if (ajaxRequest.status === 200 || ajaxRequest.status === 0) {
                successCallback(ajaxRequest.response);
            } else {
                errorCallback();
            }
        }, false);

        ajaxRequest.addEventListener("error", function () {
            errorCallback();
        }, false);

        ajaxRequest.open('GET', augmentedUrl, true);
        ajaxRequest.overrideMimeType(options.mimeType);
        try {
            ajaxRequest.send(null);
        } catch (err) {
            errorCallback();
        }
    };

    module.util.binaryAjax = function (url, options, successCallback, errorCallback) {
        var binaryContent = "";

        options = options || {};

        module.util.ajax(url, {
            mimeType: 'text/plain; charset=x-user-defined',
            cache: options.cache
        }, function (content) {
            for (var i = 0; i < content.length; i++) {
                binaryContent += String.fromCharCode(content.charCodeAt(i) & 0xFF);
            }
            successCallback(binaryContent);
        }, errorCallback);
    };

    var unquoteUrl = function (quotedUrl) {
        var doubleQuoteRegex = /^"(.*)"$/,
            singleQuoteRegex = /^'(.*)'$/;

        if (doubleQuoteRegex.test(quotedUrl)) {
            return quotedUrl.replace(doubleQuoteRegex, "$1");
        } else {
            if (singleQuoteRegex.test(quotedUrl)) {
                return quotedUrl.replace(singleQuoteRegex, "$1");
            } else {
                return quotedUrl;
            }
        }
    };

    var trimCSSWhitespace = function (url) {
        var whitespaceRegex = /^[\t\r\f\n ]*(.+?)[\t\r\f\n ]*$/;

        return url.replace(whitespaceRegex, "$1");
    };

    module.util.extractCssUrl = function (cssUrl) {
        var urlRegex = /^url\(([^\)]+)\)/,
            quotedUrl;

        if (!urlRegex.test(cssUrl)) {
            throw new Error("Invalid url");
        }

        quotedUrl = urlRegex.exec(cssUrl)[1];
        return unquoteUrl(trimCSSWhitespace(quotedUrl));
    };

    var getDataURIForImage = function (image) {
        var canvas = window.document.createElement("canvas"),
            context = canvas.getContext("2d");

        canvas.width = image.width;
        canvas.height = image.height;

        context.drawImage(image, 0, 0);

        return canvas.toDataURL("image/png");
    };

    module.util.getDataURIForImageURL = function (url, options, successCallback, errorCallback) {
        var img = new window.Image(),
            dataURI, augmentedUrl;

        options = options || {};
        augmentedUrl = options.cache === false ? getUncachableURL(url) : url;

        img.onload = function () {
            try {
                dataURI = getDataURIForImage(img);
            } catch (err) {
                // Only here is it visible, when we are violating the same-origin policy.
                errorCallback();

                return;
            }

            successCallback(dataURI);
        };
        if (errorCallback) {
            img.onerror = errorCallback;
        }
        img.src = augmentedUrl;
    };

    /* Inlining */

    var getUrlRelativeToDocumentBase = function (url, baseUrl) {
        if (baseUrl && baseUrl !== "about:blank") {
            url = module.util.joinUrl(baseUrl, url);
        }

        return url;
    };

    var getArrayForArrayLike = function (list) {
        return Array.prototype.slice.call(list);
    };

    var rulesForCssText = function (styleContent) {
        var doc = document.implementation.createHTMLDocument(""),
            styleElement = document.createElement("style");

        styleElement.textContent = styleContent;
        // the style will only parsed once it is added to a document
        doc.body.appendChild(styleElement);

        return getArrayForArrayLike(styleElement.sheet.cssRules);
    };

    var cssRulesToText = function (cssRules) {
        var cssText = "";

        cssRules.forEach(function (rule) {
            cssText += rule.cssText;
        });
        return cssText;
    };

    // @deprecated
    var parseCss = function (styleContent) {
        var parser = new CSSParser(),
            parsedCSS = parser.parse(styleContent, false, true);

        return parsedCSS;
    };

    // @deprecated
    var findBackgroundImageDeclarations = function (parsedCSS) {
        var declarationsToInline = [],
            i, j, rule;

        if (! parsedCSS) {
            return [];
        }

        for (i = 0; i < parsedCSS.cssRules.length; i++) {
            rule = parsedCSS.cssRules[i];
            if (rule.type === window.kJscsspSTYLE_RULE) {
                for (j = 0; j < rule.declarations.length; j++) {
                    if (rule.declarations[j].property === "background-image") {
                        declarationsToInline.push(rule.declarations[j]);
                    }
                }
            }
        }

        return declarationsToInline;
    };

    var findBackgroundImageRules = function (cssRules) {
        var rulesToInline = [];

        cssRules.forEach(function (rule) {
            if (rule.type === window.CSSRule.STYLE_RULE && rule.style.backgroundImage) {
                rulesToInline.push(rule);
            }
        });

        return rulesToInline;
    };

    // @deprecated
    var findFontFaceDescriptors = function (parsedCSS) {
        var descriptorsToInline = [],
            i, j, rule;

        if (! parsedCSS) {
            return [];
        }

        for (i = 0; i < parsedCSS.cssRules.length; i++) {
            rule = parsedCSS.cssRules[i];
            if (rule.type === window.kJscsspFONT_FACE_RULE) {
                for (j = 0; j < rule.descriptors.length; j++) {
                    if (rule.descriptors[j].property === "src") {
                        descriptorsToInline.push(rule.descriptors[j]);
                    }
                }
            }
        }

        return descriptorsToInline;
    };

    var findFontFaceRules = function (cssRules) {
        var rulesToInline = [];

        cssRules.forEach(function (rule) {
            if (rule.type === window.CSSRule.FONT_FACE_RULE && rule.style.getPropertyValue("src")) {
                rulesToInline.push(rule);
            }
        });

        return rulesToInline;
    };

    var cloneObject = function(object) {
        var newObject = {},
            i;
        for (i in object) {
            if (object.hasOwnProperty(i)) {
                newObject[i] = object[i];
            }
        }
        return newObject;
    };

    var isObject = function (obj) {
        return typeof obj === "object" && obj !== null;
    };

    var isCanvas = function (obj) {
        return isObject(obj) &&
            Object.prototype.toString.apply(obj).match(/\[object (Canvas|HTMLCanvasElement)\]/i);
    };

    var isFunction = function (func) {
        return typeof func === "function";
    };

    module.util.parseOptionalParameters = function () { // args: canvas, options, callback
        var parameters = {
            canvas: null,
            options: {},
            callback: null
        };

        if (isFunction(arguments[0])) {
            parameters.callback = arguments[0];
        } else {
            if (arguments[0] == null || isCanvas(arguments[0])) {
                parameters.canvas = arguments[0];

                if (isFunction(arguments[1])) {
                    parameters.callback = arguments[1];
                } else {
                    parameters.options = cloneObject(arguments[1]);
                    parameters.callback = arguments[2] || null;
                }

            } else {
                parameters.options = cloneObject(arguments[0]);
                parameters.callback = arguments[1] || null;
            }
        }

        return parameters;
    };

    /* Img Inlining */

    var encodeImageAsDataURI = function (image, baseUrl, cache, successCallback, errorCallback) {
        var url = image.attributes.src.nodeValue,  // Chrome 19 sets image.src to ""
            base = baseUrl || image.ownerDocument.baseURI;

        if (module.util.isDataUri(url)) {
            successCallback();
        }

        url = getUrlRelativeToDocumentBase(url, base);

        module.util.getDataURIForImageURL(url, {
            cache: cache
        }, function (dataURI) {
            image.attributes.src.nodeValue = dataURI;
            successCallback();
        }, function () {
            errorCallback(url);
        });
    };

    var filterInputsForImageType = function (inputs) {
        var imageTypeInputs = [];
        Array.prototype.forEach.call(inputs, function (input) {
            if (input.type === "image") {
                imageTypeInputs.push(input);
            }
        });
        return imageTypeInputs;
    };

    module.loadAndInlineImages = function (doc, options, callback) {
        var params = module.util.parseOptionalParameters(options, callback),
            images = doc.getElementsByTagName("img"),
            inputs = doc.getElementsByTagName("input"),
            baseUrl = params.options.baseUrl,
            cache = params.options.cache !== false,
            imageLike = [],
            errors = [];

        imageLike = Array.prototype.slice.call(images);
        imageLike = imageLike.concat(filterInputsForImageType(inputs));

        module.util.map(imageLike, function (image, finish) {
            encodeImageAsDataURI(image, baseUrl, cache, finish, function (url) {
                errors.push({
                    resourceType: "image",
                    url: url
                });
                finish();
            });
        }, function () {
            if (params.callback) {
                params.callback(errors);
            }
        });
    };

    /* CSS inlining */

    var adjustCssUrlPath = function (baseUrl, cssUrlPath) {
        var url;
        try {
            url = module.util.extractCssUrl(cssUrlPath);
        } catch (e) {
            return cssUrlPath;
        }

        if (module.util.isDataUri(url)) {
            return cssUrlPath;
        }

        url = module.util.joinUrl(baseUrl, url);
        return 'url("' + url + '")';
    };

    var adjustPathOfBackgroundImageRules = function (baseUrl, cssRules) {
        var backgroundImageRules = findBackgroundImageRules(cssRules),
            change = false;

        backgroundImageRules.forEach(function (rule) {
            var oldUrl = rule.style.backgroundImage,
                newUrl = adjustCssUrlPath(baseUrl, oldUrl);

            if (newUrl !== oldUrl) {
                change = true;
                rule.style.backgroundImage = newUrl;
            }
        });

        return change;
    };

    // Workaround for https://bugzilla.mozilla.org/show_bug.cgi?id=443978
    var changeFontFaceRuleUrl = function (cssRules, rule, newUrl) {
        var ruleIdx = cssRules.indexOf(rule),
            newRule = '@font-face { font-family: ' + rule.style.getPropertyValue("font-family") + '; src: ' + newUrl + '}',
            styleSheet = rule.parentStyleSheet;

        // Generate a new rule
        styleSheet.insertRule(newRule, ruleIdx+1);
        styleSheet.deleteRule(ruleIdx);
        // Exchange with the
        cssRules[ruleIdx] = styleSheet.cssRules[ruleIdx];
    };

    var adjustPathOfFontFaceRules = function (baseUrl, cssRules) {
        var fontFaceRules = findFontFaceRules(cssRules),
            change = false;

        fontFaceRules.forEach(function (rule) {
            var oldUrl = rule.style.getPropertyValue("src"),
                newUrl = adjustCssUrlPath(baseUrl, oldUrl);

            if (newUrl !== oldUrl) {
                change = true;
                changeFontFaceRuleUrl(cssRules, rule, newUrl);
            }
        });

        return change;
    };

    var adjustPathsOfCssResources = function (baseUrl, styleContent) {
        var cssRules = rulesForCssText(styleContent),
            change = false;

        change = adjustPathOfBackgroundImageRules(baseUrl, cssRules) || change;
        change = adjustPathOfFontFaceRules(baseUrl, cssRules) || change;

        if (change) {
            return cssRulesToText(cssRules);
        } else {
            return styleContent;
        }
    };

    var substituteLinkWithInlineStyle = function (oldLinkNode, styleContent) {
        var parent = oldLinkNode.parentNode,
            styleNode;

        styleContent = styleContent.trim();
        if (styleContent) {
            styleNode = oldLinkNode.ownerDocument.createElement("style");
            styleNode.type = "text/css";
            styleNode.appendChild(oldLinkNode.ownerDocument.createTextNode(styleContent));

            parent.insertBefore(styleNode, oldLinkNode);
        }

        parent.removeChild(oldLinkNode);
    };

    var loadLinkedCSS = function (link, baseUrl, cache, successCallback, errorCallback) {
        var cssHref = link.attributes.href.nodeValue, // Chrome 19 sets link.href to ""
            documentBaseUrl = baseUrl || link.ownerDocument.baseURI,
            cssHrefRelativeToDoc = getUrlRelativeToDocumentBase(cssHref, documentBaseUrl),
            cssContent;

        module.util.ajax(cssHrefRelativeToDoc, {
            cache: cache
        }, function (content) {
            cssContent = adjustPathsOfCssResources(cssHref, content);

            successCallback(cssContent);
        }, function () {
            errorCallback(cssHrefRelativeToDoc);
        });
    };

    module.loadAndInlineCSS = function (doc, options, callback) {
        var params = module.util.parseOptionalParameters(options, callback),
            links = doc.getElementsByTagName("link"),
            baseUrl = params.options.baseUrl,
            cache = params.options.cache !== false,
            errors = [];

        module.util.map(links, function (link, finish) {
            if (link.attributes.rel && link.attributes.rel.nodeValue === "stylesheet" &&
                (!link.attributes.type || link.attributes.type.nodeValue === "text/css")) {
                loadLinkedCSS(link, baseUrl, cache, function(css) {
                    substituteLinkWithInlineStyle(link, css + "\n");
                    finish();
                }, function (url) {
                    errors.push({
                        resourceType: "stylesheet",
                        url: url
                    });

                    finish();
                });
            } else {
                // We need to properly deal with non-stylesheet in this concurrent context
                finish();
            }
        }, function () {
            if (params.callback) {
                params.callback(errors);
            }
        });
    };

    /* CSS import inlining */

    var findCSSImportRules = function (cssRules) {
        var rulesToInline = [];

        cssRules.forEach(function (rule) {
            if (rule.type === window.CSSRule.IMPORT_RULE) {
                rulesToInline.push(rule);
            }
        });
        return rulesToInline;
    };

    var substituteRuleWithText = function (cssRules, rule, cssHref, cssText) {
        var cssContent = adjustPathsOfCssResources(cssHref, cssText),
            newRules = rulesForCssText(cssContent),
            position = cssRules.indexOf(rule);

        cssRules.splice(position, 1);

        newRules.forEach(function (newRule, i) {
            cssRules.splice(position + i, 0, newRule);
        });
    };

    var isQuotedString = function (string) {
        var doubleQuoteRegex = /^"(.*)"$/,
            singleQuoteRegex = /^'(.*)'$/;

        return doubleQuoteRegex.test(string) || singleQuoteRegex.test(string);
    };

    var loadAndInlineCSSImport = function (cssRules, rule, documentBaseUrl, cache, alreadyLoadedCssUrls, successCallback, errorCallback) {
        var url = rule.href,
            cssHrefRelativeToDoc;

        if (isQuotedString(url)) {
            url = unquoteUrl(url);
        }

        cssHrefRelativeToDoc = getUrlRelativeToDocumentBase(url, documentBaseUrl);

        if (alreadyLoadedCssUrls.indexOf(cssHrefRelativeToDoc) >= 0) {
            // Remove URL by adding empty string
            substituteRuleWithText(cssRules, rule, url, "");
            successCallback([]);
            return;
        } else {
            alreadyLoadedCssUrls.push(cssHrefRelativeToDoc);
        }

        module.util.ajax(cssHrefRelativeToDoc, {cache: cache}, function (cssText) {
            // Recursively follow @import statements
            loadCSSImportsForString(cssText, documentBaseUrl, cache, alreadyLoadedCssUrls, function (newCssText, errors) {
                substituteRuleWithText(cssRules, rule, url, newCssText);

                successCallback(errors);
            });
        }, function () {
            errorCallback(cssHrefRelativeToDoc);
        });
    };

    var loadCSSImportsForString = function (cssContent, baseUrl, cache, alreadyLoadedCssUrls, callback) {
        var cssRules = rulesForCssText(cssContent),
            errors = [],
            rulesToInline;

        rulesToInline = findCSSImportRules(cssRules);

        // CSSParser is invasive, if no changes are needed, we leave the text as it is
        if (rulesToInline.length === 0) {
            callback(cssContent, errors);
            return;
        }

        rasterizeHTML.util.map(rulesToInline, function (rule, finish) {
            loadAndInlineCSSImport(cssRules, rule, baseUrl, cache, alreadyLoadedCssUrls, function (moreErrors) {
                errors = errors.concat(moreErrors);

                finish();
            }, function (url) {
                errors.push({
                    resourceType: "stylesheet",
                    url: url
                });

                finish();
            });
        }, function () {
            cssContent = cssRulesToText(cssRules);

            callback(cssContent, errors);
        });
    };

    var loadAndInlineCSSImportsForStyle = function (style, baseUrl, cache, alreadyLoadedCssUrls, callback) {
        loadCSSImportsForString(style.textContent, baseUrl, cache, alreadyLoadedCssUrls, function (newCssContent, errors) {
            if (style.textContent !== newCssContent) {
                style.childNodes[0].nodeValue = newCssContent;
            }

            callback(errors);
        });
    };

    module.loadAndInlineCSSImports = function (doc, options, callback) {
        var params = module.util.parseOptionalParameters(options, callback),
            styles = doc.getElementsByTagName("style"),
            base = params.options.baseUrl || doc.baseURI,
            cache = params.options.cache !== false,
            allErrors = [],
            alreadyLoadedCssUrls = [];

        module.util.map(styles, function (style, finish) {
            if (style.attributes.type && style.attributes.type.nodeValue === "text/css") {
                loadAndInlineCSSImportsForStyle(style, base, cache, alreadyLoadedCssUrls, function (errors) {
                    allErrors = allErrors.concat(errors);

                    finish();
                });
            } else {
                // We need to properly deal with non-css in this concurrent context
                finish();
            }
        }, function () {
            params.callback(allErrors);
        });
    };

    /* CSS linked resource inlining */

    var loadAndInlineBackgroundImage = function (cssDeclaration, baseUri, cache, successCallback, errorCallback) {
        var url;
        try {
            url = module.util.extractCssUrl(cssDeclaration.values[0].cssText());
        } catch (e) {
            successCallback(false);
            return;
        }

        if (module.util.isDataUri(url)) {
            successCallback(false);
            return;
        }

        url = getUrlRelativeToDocumentBase(url, baseUri);

        module.util.getDataURIForImageURL(url, {
            cache: cache
        }, function (dataURI) {
            cssDeclaration.values[0].setCssText('url("' + dataURI + '")');

            successCallback(true);
        }, function () {
            errorCallback(url);
        });
    };

    var iterateOverRulesAndInlineBackgroundImage = function (parsedCss, baseUri, cache, callback) {
        var declarationsToInline = findBackgroundImageDeclarations(parsedCss),
            errors = [],
            cssHasChanges;

        rasterizeHTML.util.map(declarationsToInline, function (declaration, finish) {
            loadAndInlineBackgroundImage(declaration, baseUri, cache, finish, function (url) {
                errors.push({
                    resourceType: "backgroundImage",
                    url: url
                });
                finish();
            });

        }, function (changedStates) {
            cssHasChanges = changedStates.indexOf(true) >= 0;
            callback(cssHasChanges, errors);
        });
    };

    var loadAndInlineFontFace = function (cssDeclaration, baseUri, cache, successCallback, errorCallback) {
        var url, base64Content;
        try {
            url = module.util.extractCssUrl(cssDeclaration.values[0].cssText());
        } catch (e) {
            successCallback(false);
            return;
        }

        if (module.util.isDataUri(url)) {
            successCallback(false);
            return;
        }

        url = getUrlRelativeToDocumentBase(url, baseUri);

        module.util.binaryAjax(url, {
            cache: cache
        }, function (content) {
            base64Content = btoa(content);
            cssDeclaration.values[0].setCssText('url("data:font/woff;base64,' + base64Content + '")');

            successCallback(true);
        }, function () {
            errorCallback(url);
        });
    };

    var iterateOverRulesAndInlineFontFace = function (parsedCss, baseUri, cache, callback) {
        var descriptorsToInline = findFontFaceDescriptors(parsedCss),
            errors = [],
            cssHasChanges;

        rasterizeHTML.util.map(descriptorsToInline, function (declaration, finish) {
            loadAndInlineFontFace(declaration, baseUri, cache, finish, function (url) {
                errors.push({
                    resourceType: "fontFace",
                    url: url
                });
                finish();
            });

        }, function (changedStates) {
            cssHasChanges = changedStates.indexOf(true) >= 0;
            callback(cssHasChanges, errors);
        });
    };

    var workAroundWebkitBugIgnoringTheFirstRuleInCSS = function (cssContent, parsedCss) {
        // Works around bug with webkit ignoring the first rule in each style declaration when rendering the SVG to the
        // DOM. While this does not directly affect the process when rastering to canvas, this is needed for the
        // workaround found in workAroundBrowserBugForBackgroundImages();
        var hasBackgroundImageDeclarations = (findBackgroundImageDeclarations(parsedCss).length +
                findFontFaceDescriptors(parsedCss).length) > 0;

        if (hasBackgroundImageDeclarations && window.navigator.userAgent.indexOf("WebKit") >= 0) {
            return "span {}\n" + cssContent;
        } else {
            return cssContent;
        }
    };

    var loadAndInlineCSSResourcesForStyle = function (style, baseUrl, cache, callback) {
        var cssContent = style.textContent,
            base = baseUrl || style.ownerDocument.baseURI,
            parsedCss = parseCss(cssContent);

        iterateOverRulesAndInlineBackgroundImage(parsedCss, base, cache, function (bgImagesHaveChanges, bgImageErrors) {
            iterateOverRulesAndInlineFontFace(parsedCss, base, cache, function (fontsHaveChanges, fontFaceErrors) {
                // CSSParser is invasive, if no changes are needed, we leave the text as it is
                if (bgImagesHaveChanges || fontsHaveChanges) {
                    cssContent = parsedCss.cssText();
                }
                cssContent = workAroundWebkitBugIgnoringTheFirstRuleInCSS(cssContent, parsedCss);
                style.childNodes[0].nodeValue = cssContent;

                callback(bgImageErrors.concat(fontFaceErrors));
            });
        });
    };

    module.loadAndInlineCSSReferences = function (doc, options, callback) {
        var params = module.util.parseOptionalParameters(options, callback),
            allErrors = [],
            baseUrl = params.options.baseUrl,
            cache = params.options.cache !== false,
            styles = doc.getElementsByTagName("style");

        module.util.map(styles, function (style, finish) {
            if (style.attributes.type && style.attributes.type.nodeValue === "text/css") {
                loadAndInlineCSSResourcesForStyle(style, baseUrl, cache, function (errors) {
                    allErrors = allErrors.concat(errors);
                    finish();
                });
            } else {
                // We need to properly deal with non-css in this concurrent context
                finish();
            }
        }, function () {
            if (params.callback) {
                params.callback(allErrors);
            }
        });
    };

    /* Rendering */

    var needsXMLParserWorkaround = function() {
        // See https://bugs.webkit.org/show_bug.cgi?id=47768
        return window.navigator.userAgent.indexOf("WebKit") >= 0;
    };

    var serializeToXML = function (doc) {
        var xml;

        doc.documentElement.setAttribute("xmlns", doc.documentElement.namespaceURI);
        xml = (new window.XMLSerializer()).serializeToString(doc.documentElement);
        if (needsXMLParserWorkaround()) {
            if (window.HTMLtoXML) {
                return window.HTMLtoXML(xml);
            } else {
                module.util.log("Looks like your browser needs htmlparser.js as workaround for writing XML. " +
                    "Please include it.");
                return xml;
            }
        } else {
            return xml;
        }
    };

    var supportsBlobBuilding = function () {
        // Newer Safari (under PhantomJS) seems to support blob building, but loading an image with the blob fails
        if (window.navigator.userAgent.indexOf("WebKit") >= 0 && window.navigator.userAgent.indexOf("Chrome") < 0) {
            return false;
        }
        if (window.BlobBuilder || window.MozBlobBuilder || window.WebKitBlobBuilder) {
            // Deprecated interface
            return true;
        } else {
            if (window.Blob) {
                // Available as constructor only in newer builds for all Browsers
                try {
                    new window.Blob('<b></b>', { "type" : "text\/xml" });
                    return true;
                } catch (err) {
                    return false;
                }
            }
        }
        return false;
    };

    var getBlob = function (data) {
       var imageType = "image/svg+xml;charset=utf-8",
           BLOBBUILDER = window.BlobBuilder || window.MozBlobBuilder || window.WebKitBlobBuilder,
           svg;
       if (BLOBBUILDER) {
           svg = new BLOBBUILDER();
           svg.append(data);
           return svg.getBlob(imageType);
       } else {
           return new window.Blob(data, {"type": imageType});
       }
    };

    var buildImageUrl = function (svg) {
        var DOMURL = window.URL || window.webkitURL || window;
        if (supportsBlobBuilding()) {
            return DOMURL.createObjectURL(getBlob(svg));
        } else {
            return "data:image/svg+xml;charset=utf-8," + svg;
        }
    };

    var cleanUpUrl = function (url) {
        var DOMURL = window.URL || window.webkitURL || window;
        if (supportsBlobBuilding()) {
            DOMURL.revokeObjectURL(url);
        }
    };

    var getOrCreateHiddenDivWithId = function (doc, id) {
        var div = doc.getElementById(id);
        if (! div) {
            div = doc.createElement("div");
            div.style.visibility = "hidden";
            div.style.width = "0px";
            div.style.height = "0px";
            div.style.position = "absolute";
            div.style.top = "-10000px";
            div.style.left = "-10000px";
            div.id = id;
            doc.getElementsByTagName("body")[0].appendChild(div);
        }

        return div;
    };

    var WORKAROUND_ID = "rasterizeHTML_js_FirefoxWorkaround";

    var workAroundBrowserBugForBackgroundImages = function (svg, canvas) {
        // Firefox, Chrome & Safari will (sometimes) not show an inlined background-image until the svg is connected to
        // the DOM it seems.
        var uniqueId = module.util.getConstantUniqueIdFor(svg),
            doc = canvas ? canvas.ownerDocument : window.document,
            doNotGarbageCollect = getOrCreateHiddenDivWithId(doc, WORKAROUND_ID + uniqueId);

        doNotGarbageCollect.innerHTML = svg;
        doNotGarbageCollect.className = WORKAROUND_ID; // Make if findable for debugging & testing purposes
    };

    var cleanUpAfterWorkAroundForBackgroundImages = function (svg, canvas) {
        var uniqueId = module.util.getConstantUniqueIdFor(svg),
            doc = canvas ? canvas.ownerDocument : window.document,
            div = doc.getElementById(WORKAROUND_ID + uniqueId);
        if (div) {
            div.parentNode.removeChild(div);
        }
    };

    module.getSvgForDocument = function (doc, width, height) {
        var html = serializeToXML(doc);

        return (
            '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '">' +
                '<foreignObject width="100%" height="100%">' +
                    html +
                '</foreignObject>' +
            '</svg>'
        );
    };

    module.renderSvg = function (svg, canvas, successCallback, errorCallback) {
        var url, image,
            resetEventHandlers = function () {
                image.onload = null;
                image.onerror = null;
            },
            cleanUp = function () {
                if (url) {
                    cleanUpUrl(url);
                }
                cleanUpAfterWorkAroundForBackgroundImages(svg, canvas);
            };

        workAroundBrowserBugForBackgroundImages(svg, canvas);

        url = buildImageUrl(svg);

        image = new window.Image();
        image.onload = function() {
            resetEventHandlers();
            cleanUp();
            successCallback(image);
        };
        image.onerror = function () {
            cleanUp();

            // Webkit calls the onerror handler if the SVG is faulty
            errorCallback();
        };
        image.src = url;
    };

    module.drawImageOnCanvas = function (image, canvas) {
        try {
            canvas.getContext("2d").drawImage(image, 0, 0);
        } catch (e) {
            // Firefox throws a 'NS_ERROR_NOT_AVAILABLE' if the SVG is faulty
            return false;
        }

        return true;
    };

    var inlineReferences = function (doc, options, callback) {
        var allErrors = [];

        module.loadAndInlineImages(doc, options, function (errors) {
            allErrors = allErrors.concat(errors);
            module.loadAndInlineCSS(doc, options, function (errors) {
                allErrors = allErrors.concat(errors);
                module.loadAndInlineCSSImports(doc, options, function (errors) {
                    allErrors = allErrors.concat(errors);
                    module.loadAndInlineCSSReferences(doc, options, function (errors) {
                        allErrors = allErrors.concat(errors);

                        callback(allErrors);
                    });
                });
            });
        });
    };

    /* "Public" API */

    module.drawDocument = function (doc, canvas, options, callback) {
        var params = module.util.parseOptionalParameters(canvas, options, callback),
            handleInternalError = function (errors) {
                errors.push({
                    resourceType: "document"
                });
            },
            fallbackWidth = params.canvas ? params.canvas.width : 300,
            fallbackHeight = params.canvas ? params.canvas.height : 200,
            width = params.options.width !== undefined ? params.options.width : fallbackWidth,
            height = params.options.height !== undefined ? params.options.height : fallbackHeight;

        inlineReferences(doc, params.options, function (allErrors) {

            var svg = module.getSvgForDocument(doc, width, height),
                successful;

            module.renderSvg(svg, params.canvas, function (image) {
                if (params.canvas) {
                    successful = module.drawImageOnCanvas(image, params.canvas);

                    if (!successful) {
                        handleInternalError(allErrors);
                        image = null;   // Set image to null so that Firefox behaves similar to Webkit
                    }
                }

                if (params.callback) {
                    params.callback(image, allErrors);
                }
            }, function () {
                handleInternalError(allErrors);

                if (params.callback) {
                    params.callback(null, allErrors);
                }

            });
        });
    };

    module.drawHTML = function (html, canvas, options, callback) {
        var params = module.util.parseOptionalParameters(canvas, options, callback),
            doc = window.document.implementation.createHTMLDocument("");

        doc.documentElement.innerHTML = html;
        module.drawDocument(doc, params.canvas, params.options, params.callback);
    };

    module.drawURL = function (url, canvas, options, callback) {
        var params = module.util.parseOptionalParameters(canvas, options, callback),
            cache = params.options.cache;

        params.options.baseUrl = url;

        module.util.ajax(url, {
            cache: cache
        }, function (html) {
            module.drawHTML(html, params.canvas, params.options, params.callback);
        }, function () {
            if (params.callback) {
                params.callback(null, [{
                    resourceType: "page",
                    url: url
                }]);
            }
        });
    };

    return module;
}(window, URI, CSSParser));
