import fs from "fs";
import { PdfReader } from "pdfreader";
import axios from "axios";
import http from "http";
import https from "https";
import crypto from "crypto";
import { pipeline } from "stream/promises";

const REQUEST_TIMEOUT_MS = 60_000;

// Disable SSL certificate validation
const allowLegacyRenegotiation = {
  httpAgent: new http.Agent({
    rejectUnauthorized: false,
    secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT,
    keepAlive: true,
  }),
  httpsAgent: new https.Agent({
    rejectUnauthorized: false,
    secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT,
    keepAlive: true,
  }),
};

async function writeFile(filePath, content) {
  return new Promise((resolve, reject) => {
    fs.writeFile(filePath, content, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function readFile(filePath) {
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, "utf8", (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

async function appendToFile(filePath, content) {
  return new Promise((resolve, reject) => {
    fs.appendFile(filePath, content, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

let count = 0;
let totalCount = 0;
let lastUpdatedDate = null;
let list = [];

// Function to format rows for MD file
const rowFormatter = (row) => {
  if (row.length === 3) {
    count++;
    totalCount++;
    return `| ${row.join(" | ")} |\n`;
  } else if (row.length === 2) {
    totalCount++;
    return `| ${row[0]} |  | ${row[1]} |\n`;
  }
  return "";
};

const jsonFormatter = (row) => {
  if (row.length === 3) {
    return { prefix: row[0], operator: row[1], status: row[2] };
  } else if (row.length === 2) {
    return { prefix: row[0], operator: "", status: row[1] };
  }
  return {};
};

const PAGE_URL = "https://www.btk.gov.tr/numara-tasinabilirligi-yonlendirme-kodlari";
// Tried in order when the URL from the page is missing or fails
const FALLBACK_PDF_URLS = [
  "https://www.btk.gov.tr/s3/web-btk-site/uploads/ntsfiles/BXXX.pdf",
  "https://www.btk.gov.tr/uploads/ntsfiles/BXXX.pdf",
];

async function fetchPdfUrl() {
  const pageResponse = await axios({
    method: "get",
    url: PAGE_URL,
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "tr,en-US;q=0.9,en;q=0.8",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    },
    ...allowLegacyRenegotiation,
  });

  const urls = String(pageResponse.data).match(/https?:\/\/[^"'\s<>\\]+\.pdf/gi) || [];
  // Page may contain other PDFs; prefer the BXXX routing-code file
  const url = urls.find((u) => /\/BXXX\.pdf$/i.test(u)) || urls[0];
  if (!url) throw new Error("PDF URL not found on BTK page");
  return url;
}

async function downloadPdf(url, pdfPath) {
  let response;
  try {
    response = await axios({
      method: "get",
      timeout: REQUEST_TIMEOUT_MS,
      url,
      responseType: "stream",
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "Accept-Encoding": "gzip, deflate, br, zstd",
        "Accept-Language": "tr,en-US;q=0.9,en;q=0.8,tr-TR;q=0.7,zh-CN;q=0.6,zh-TW;q=0.5,zh;q=0.4,ja;q=0.3,ko;q=0.2,bg;q=0.1",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Host": "www.btk.gov.tr",
        "Pragma": "no-cache",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        "sec-ch-ua": '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
      },
      ...allowLegacyRenegotiation,
    });
  } catch (err) {
    // Unconsumed error stream keeps the keep-alive socket open; destroy it so the process can exit
    err?.response?.data?.destroy?.();
    throw new Error(`Error downloading PDF: ${err?.response?.status ?? ""} ${err?.message}`.trim());
  }

  await pipeline(response.data, fs.createWriteStream(pdfPath));

  // Server may return an HTML error page with 200; check the PDF magic bytes
  const fd = fs.openSync(pdfPath, "r");
  const magic = Buffer.alloc(5);
  fs.readSync(fd, magic, 0, 5, 0);
  fs.closeSync(fd);
  if (magic.toString("latin1") !== "%PDF-") throw new Error("Downloaded file is not a PDF");
}

// Main function
const processPDF = async () => {
  // Step 1: Fetch PDF URL from BTK page
  const candidates = [];
  try {
    const pageUrl = await fetchPdfUrl();
    console.log("Found PDF URL:", pageUrl);
    candidates.push(pageUrl);
  } catch (err) {
    console.warn(`Could not get PDF URL from page: ${err?.message}`);
  }
  for (const url of FALLBACK_PDF_URLS) {
    if (!candidates.includes(url)) candidates.push(url);
  }

  // Step 3: Download PDF, trying each candidate URL in order
  const pdfPath = "./BXXX.pdf";
  let pdfUrl;
  for (const url of candidates) {
    try {
      await downloadPdf(url, pdfPath);
      pdfUrl = url;
      break;
    } catch (err) {
      console.warn(`${err?.message} (${url})`);
    }
  }
  if (!pdfUrl) throw new Error("PDF could not be downloaded from any URL");
  console.log("Downloaded PDF file:", pdfUrl);

  // Step 4: Initialize markdown file
  const mdPath = "./README.MD";
  await writeFile(mdPath, "");
  await appendToFile(mdPath,`# Numara Taşınabilirliği Yönlendirme Kodları\n\n`);
  //await appendToFile(mdPath, `## Son Güncellenme Tarihi: \n\n`);
  await appendToFile(mdPath, "## Kayıt Sayısı: \n\n");
  await appendToFile(mdPath, `### Kaynak: <${PAGE_URL}> | <${pdfUrl}>\n\n`);
  await appendToFile(mdPath,"| Önek | İşletmeci | Durum |\n| --- | --- | --- |\n");

  let rows = {}; // To store rows from the PDF

  // Step 5: Parse the PDF and accumulate rows
  await new Promise((resolve, reject) => {
    let writes = Promise.resolve(); // Keep page writes ordered and awaitable
    new PdfReader().parseFileItems(pdfPath, function (err, item) {
      if (err) return reject(err);

      if (!item || item?.page) {
        // End of page, print rows
        const rowStrings = Object.keys(rows)
          .sort((y1, y2) => parseFloat(y1) - parseFloat(y2)) // Sort by Y position
          .map((y) => {
            list.push(jsonFormatter(rows[y]));
            return rowFormatter(rows[y])
          });

        if (rowStrings.length > 0) {
          const chunk = rowStrings.join(""); // Write all rows at once
          writes = writes.then(() => appendToFile(mdPath, chunk));
        }

        rows = {}; // Clear rows for the next page
        if(item?.page) console.log("PAGE:", item?.page);
        // No item means end of file: resolve once all writes are done
        if (!item) writes.then(resolve, reject);
      } else if (item.text) {
        if(item.text.includes(new Date().getFullYear().toString()) || item.text.includes(new Date().getFullYear() - 1)) {
          lastUpdatedDate = item.text;
        }
        // Filter unnecessary text
        if (
          [
            "Önek",
            "İşletmeci",
            "Durum",
            "Numara Taşınabilirliği Yönlendirme Kodları",
          ].includes(item.text) ||
          item.text.includes("Rapor Tarihi:") ||
          item.text.includes("Kayıt Sayısı:") ||
          item.text.includes(new Date().getFullYear().toString())
        ) {
          return;
        }
        if(item.text === 'Bos') item.text = 'Boş';

        // Accumulate row data based on Y position
        (rows[item.y] = rows[item.y] || []).push(item.text);
      }
    });
  });

  // Step 6: Sort lines and update metadata in the markdown file
  const fileContent = await readFile(mdPath, "utf8");
  let splitCount = 8;
  const headers = fileContent.split("\n").slice(0, splitCount);
  let lines = fileContent.split("\n").slice(splitCount).filter(Boolean);

  console.log("Total used records:", count);
  console.log("Total records:", totalCount);
  console.log(`Last updated date:`, lastUpdatedDate);

  // Sort lines
  lines = lines.sort((a, b) => (a > b ? 1 : -1));

  // Update headers with the current date and record count
  headers.forEach((line, index) => {
    /*if (line.includes("Son Güncellenme Tarihi:")) {
      headers[
        index
      ] = `## Son Güncellenme Tarihi: ${lastUpdatedDate}`;
    }*/
    if (line.includes("Kayıt Sayısı:")) {
      headers[index] = `## Kayıt Sayısı: ${count}/${totalCount}`;
    }
  });

  const updatedContent = [...headers, ...lines, ''].join("\n");
  await writeFile(mdPath, updatedContent);
  list = list.filter((item) => Object.keys(item).length > 0);
  await writeFile("list.json", JSON.stringify(list, null, 2));
  console.log("Markdown and list.json file created and updated successfully.");
}

// Run the process
processPDF()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    // Close keep-alive sockets so a lingering connection can't keep the job running for hours
    allowLegacyRenegotiation.httpAgent.destroy();
    allowLegacyRenegotiation.httpsAgent.destroy();
  });
