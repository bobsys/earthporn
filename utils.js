/**
 * Common utility functions for Bob's Stuff project.
 */

// Cache Configuration
const CACHE_KEY_PREFIX = 'rss_feed_';
const CACHE_EXPIRY_MS = 60 * 60 * 1000; // 1 hour
const MAX_CACHE_SIZE = 4.5 * 1024 * 1024; // ~4.5MB

/**
 * Decodes HTML entities and strips all HTML tags from a string.
 */
function stripHTML(text) {
    if (!text) return '';
    const decode = (str) => {
        const d = document.createElement('div');
        d.innerHTML = str;
        return d.textContent || d.innerText || '';
    };
    const div = document.createElement('div');
    const pass1 = decode(text);
    div.innerHTML = pass1;
    return (div.textContent || div.innerText || '').trim();
}

/**
 * Decodes twice and strips HTML. Removes common RSS artifacts.
 */
function sanitizeDescription(html) {
    if (!html) return 'No summary available.';
    const text = stripHTML(html);
    // Remove common RSS artifacts like "Copyright RealClearPolitics" or similar footers
    const cleaned = text.replace(/Copyright\s+\d{4}.*$/i, '');
    return cleaned.trim().slice(0, 600) || 'No summary available.';
}

/**
 * LocalStorage Caching Functions
 */
function getCacheKey(url) {
    return CACHE_KEY_PREFIX + encodeURIComponent(url);
}

function getCacheSize() {
    let total = 0;
    for (let x in localStorage) {
        if (localStorage.hasOwnProperty(x)) {
            total += ((localStorage[x].length + x.length) * 2);
        }
    }
    return total;
}

function clearCache(url) {
    try {
        localStorage.removeItem(getCacheKey(url));
    } catch (e) {
        console.error('Failed to clear cache for', url, ':', e);
    }
}

function setCache(url, data) {
    try {
        const cacheData = {
            timestamp: Date.now(),
            items: data.slice(0, 10)
        };
        const serialized = JSON.stringify(cacheData);
        if (getCacheSize() + serialized.length * 2 > MAX_CACHE_SIZE) {
            const keys = Object.keys(localStorage)
                .filter(k => k.startsWith(CACHE_KEY_PREFIX))
                .map(k => {
                    try {
                        return { key: k, timestamp: JSON.parse(localStorage[k]).timestamp };
                    } catch (e) {
                        return { key: k, timestamp: 0 };
                    }
                })
                .sort((a, b) => a.timestamp - b.timestamp);
            if (keys.length) {
                localStorage.removeItem(keys[0].key);
            }
        }
        localStorage.setItem(getCacheKey(url), serialized);
    } catch (e) {
        console.error('Failed to set cache for', url, ':', e);
    }
}

function getCache(url) {
    try {
        const data = localStorage.getItem(getCacheKey(url));
        if (!data) return null;
        const parsed = JSON.parse(data);
        if (!parsed || !parsed.timestamp || !parsed.items || (Date.now() - parsed.timestamp > CACHE_EXPIRY_MS)) {
            clearCache(url);
            return null;
        }
        return parsed.items;
    } catch (e) {
        return null;
    }
}

/**
 * Triggers a browser download of JSON data as a file.
 */
function downloadJson(data, filename) {
    const jsonString = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

/**
 * Fisher-Yates Shuffle Algorithm.
 */
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + i));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

/**
 * Displays a status message to the user.
 */
function showMessage(txt, sticky = false) {
    const msg = document.getElementById('message-overlay');
    if (!msg) return;
    msg.textContent = txt;
    msg.classList.add('visible');
    if (!sticky) setTimeout(() => msg.classList.remove('visible'), 3000);
}

/**
 * Debounce utility function.
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

export { stripHTML, sanitizeDescription, getCache, setCache, clearCache, downloadJson, shuffleArray, showMessage, debounce };