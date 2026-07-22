// ==UserScript==
// @name         Limey's Custom Discord OAuth Branding
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Custom Discord OAuth background, logo, and text edits
// @match        https://discord.com/oauth2/authorize?client_id=1514929209158402078*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // ==========================
    // CUSTOM BACKGROUND
    // ==========================

    const newBackground =
        "data:image/png;base64," +
        `
IMAGE BASE 64
        `.replace(/\s+/g, "");


    // ==========================
    // CUSTOM LOGO
    // ==========================

    const newLogo =
        "data:image/png;base64," +
        `
IMAGE BASE 64
        `.replace(/\s+/g, "");


    // ==========================
    // BRANDING CHANGES
    // ==========================

    function applyBranding() {

        // Replace OAuth background
        const bg = document.querySelector(".characterBackground_eb4069");

        if (bg) {
            bg.style.backgroundImage = `url("${newBackground}")`;
            bg.style.backgroundSize = "cover";
            bg.style.backgroundPosition = "center";
            bg.style.backgroundRepeat = "no-repeat";

            const artwork = bg.querySelector(".artwork_eb4069");

            if (artwork) {
                artwork.style.display = "none";
            }
        }


        // Replace OAuth logo
        const logo = document.querySelector(".logoWithText_eb4069");

        if (logo) {
            logo.src = newLogo;
            logo.removeAttribute("srcset");
            logo.alt = "Limey";
            logo.style.width = "50px";
            logo.style.height = "auto";
            logo.style.objectFit = "contain";
        }

    }


    // ==========================
    // TEXT REPLACEMENTS
    // ==========================

    function replaceText() {

        const replacements = {
            "Opening Discord App.": "Loading Discord's OAuth",
            "Add to My Apps": "Add to Discord Account",
            "Use this app everywhere!": "You can revoke its authorization in Settings/Authorised Apps",
            "Add to Server": "Add to Discord Server",
            "Customize your server by adding this app": "You can remove the bot in Server Settings/Integrations.",
            "wants to access your Discord account": "Please select an option below",
            "Signed in as": "You are authorising Limey as",
            "This will allow the developer of Limey to:": "This will allow Limey to:",
            "Send you direct messages": "Send you notifications",
            "Add a bot to a server": "Add Limey to your server",
            "You missed some fields": "Waiting for selection",
            "Continue": "Proceed to dashboard",
            "Authorize": "Proceed to dashboard"
        };


        document.querySelectorAll("*").forEach(el => {

            if (el.children.length === 0 && el.textContent.trim()) {

                for (const [oldText, newText] of Object.entries(replacements)) {

                    if (el.textContent.includes(oldText)) {
                        el.textContent = el.textContent.replace(oldText, newText);
                    }

                }

            }

        });

    }


    // ==========================
    // RUN ON PAGE LOAD + UPDATES
    // ==========================

    function updatePage() {
        applyBranding();
        replaceText();
    }


    updatePage();


    const observer = new MutationObserver(() => {
        updatePage();
    });


    observer.observe(document.body, {
        childList: true,
        subtree: true
    });


})();
