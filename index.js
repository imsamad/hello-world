const { chromium } = require('playwright');
const fs = require('fs');

const first = async () => {
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    const booksUrls = new Set(); // avoid duplicates

    try {
        for (let pageNum = 1; pageNum <= 64; pageNum++) {
            console.log(`Scraping page ${pageNum}...`);

            await page.goto(`https://bookmaza.com/shop/page/${pageNum}`, {
                waitUntil: 'domcontentloaded',
                timeout: 60000,
            });

            // wait for product list
            await page.waitForSelector('ul.products li a', { timeout: 15000 });

            // evaluate inside browser context (fast + clean)
            const urls = await page.$$eval(
                'ul.products li a',
                anchors => anchors.map(a => a.href)
            );
            console.log("urlsL ", urls.length)
            // Spread the new URLs into the Set
            urls.forEach(url => booksUrls.add(url));
        }

        console.log(`\nTotal unique books: ${booksUrls.size}`);
        console.log([...booksUrls]);
        // Join with newline
        const content = [...booksUrls].join('\n');

        fs.writeFileSync('output.txt', content);
    } catch (err) {
        console.error('Error occurred:', err.message);
    } finally {
        await browser.close();
    }
}

const loadUrls = (path) => {


    // 1. Read the file contents synchronously as a UTF-8 string
    const fileContent = fs.readFileSync(path, 'utf8');

    // 2. Split the string by newlines to create an array
    // Using .filter(Boolean) ensures we remove any empty lines (like a trailing newline at the end of the file)
    const urlsArray = fileContent.split('\n').filter(Boolean);

    // console.log(urlsArray);

    return urlsArray
}

const downlaodPdfLinks = async () => {
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    const booksUrls = new Set(); // avoid duplicates


    const urlsArray = loadUrls();
    try {
        for (let pageNum = 0; pageNum < urlsArray.length; pageNum++) {
            console.log(`Scraping page ${pageNum}...`);

            await page.goto(urlsArray[pageNum], {
                waitUntil: 'domcontentloaded',
                timeout: 60000,
            });
            // find anchor tag with Download text and copy its href attribute
            const downloadLink = await page.$('a:has-text("Download")');
            if (downloadLink) {
                const href = await downloadLink.getAttribute('href');
                booksUrls.add(href);
            }

        }

        console.log(`\nTotal unique books: ${booksUrls.size}`);
        console.log([...booksUrls]);

    } catch (err) {
        console.error('Error occurred:', err.message);
    } finally {
        // Join with newline
        const content = [...booksUrls].join('\n');

        fs.writeFileSync('output_downloaded.txt', content);
        await browser.close();
    }
};

const path = require("path");
const axios = require("axios");
const books_temp = require("./book_links.js");

const downloadPDf = async () => {
    let books = [...books_temp].filter(b => !b.isDownloaded)
    try {
        for (let i = 0; i < books.length; i++) {
            try {
                const isPdf = books[i].pdfUrl.endsWith(".pdf");
                if (!isPdf) {
                    continue;
                }
                if (books[i].isDownloaded) {
                    continue;
                }
                const bookName = books[i].bookName;
                console.log("bookName", bookName);
                // continue;
                const response = await axios({
                    url: books[i].pdfUrl,
                    method: "GET",
                    responseType: "stream",
                    timeout: 60000 * 10,
                    headers: {
                        "User-Agent": "Mozilla/5.0",
                    },
                });

                const filePath = path.join("downloads", `${bookName}.pdf`);
                const writer = fs.createWriteStream(filePath);

                response.data.pipe(writer);

                await new Promise((resolve, reject) => {
                    writer.on("finish", resolve);
                    writer.on("error", reject);
                });

                books[i].isDownloaded = true;
                console.log(`Saved: ${bookName}.pdf`);
            } catch (error) {
                console.log("error: ", error.message);
            }
        }

    } catch (error) {
        console.error("Error:", error.message);
    } finally {
    }
};


(() => {
    // downloadPDf()
    console.log("total:", books_temp.length);
    console.log("downloaded: ", books_temp.filter(b => b.isDownloaded).length);
    console.log("not downloaded: ", books_temp.filter(b => !b.isDownloaded).length);
    const books = JSON.parse(JSON.stringify(books_temp)).sort((a, b) => a.isDownloaded ? 1 : -1)
    // .map((book) => {
    //     const bookname = book.bookName + ".pdf";
    //     // if file with bookname exist;
    //     console.log("bok", bookname)
    //     if (fs.existsSync(path.join("downloads", bookname))) {
    //         console.log("found: ", bookname);
    //         book.isDownloaded = true;
    //     }
    //     return book;
    // });

    fs.writeFileSync('book_links.js', "module.exports = " + JSON.stringify(books, null, 4));



})()