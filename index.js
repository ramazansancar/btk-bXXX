import fs from "fs";
import { PdfReader } from "pdfreader";
import axios from "axios";
import http from "http";
import https from "https";
import crypto from "crypto";

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

// Function to format rows for MD file
const rowFormatter = (row) => {
  totalCount++;
  if (row.length === 3) {
    count++;
    return `| ${row.join(" | ")} |\n`;
  } else if (row.length === 2) {
    return `| ${row[0]} |  | ${row[1]} |\n`;
  }
  return "";
};

// Main function
async function processPDF() {
  // Step 1: Download PDF
  const response = await axios({
    method: "get",
    url: "https://www.btk.gov.tr/uploads/ntsfiles/BXXX.pdf",
    responseType: "stream",
    headers: {
      Accept: "*/*",
      "accept-encoding": "gzip, deflate, br",
      "accept-language": "tr,en-US;q=0.9",
      "cache-control": "no-cache",
      pragma: "no-cache",
    },
    ...allowLegacyRenegotiation,
  });

  const pdfPath = "./BXXX.pdf";
  response.data.pipe(fs.createWriteStream(pdfPath));

  await new Promise((resolve) => response.data.on("end", resolve));
  console.log("Downloaded PDF file.");

  // Step 2: Initialize markdown file
  const mdPath = "./BXXX.MD";
  await writeFile(mdPath, "");
  await appendToFile(mdPath,`# Numara Taşınabilirliği Yönlendirme Kodları\n\n`);
  await appendToFile(mdPath, `## Son Güncellenme Tarihi: \n\n`);
  await appendToFile(mdPath, "## Kayıt Sayısı: \n\n");
  await appendToFile(mdPath, "Kaynak: <https://www.btk.gov.tr/numara-tasinabilirligi-yonlendirme-kodlari>\n\n");
  await appendToFile(mdPath,"| Önek | İşletmeci | Durum |\n| --- | --- | --- |\n");

  let rows = {}; // To store rows from the PDF

  // Step 3: Parse the PDF and accumulate rows
  await new Promise((resolve, reject) => {
    new PdfReader().parseFileItems(pdfPath, function (err, item) {
      if (err) reject(err);

      if (!item || item.page) {
        // End of page, print rows
        const rowStrings = Object.keys(rows)
          .sort((y1, y2) => parseFloat(y1) - parseFloat(y2)) // Sort by Y position
          .map((y) => {
            return rowFormatter(rows[y])
          });

        if (rowStrings.length > 0) {
          appendToFile(mdPath, rowStrings.join("")); // Write all rows at once
        }

        rows = {}; // Clear rows for the next page
        console.log("PAGE:", item?.page);
      } else if (item.text) {
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

        // Accumulate row data based on Y position
        (rows[item.y] = rows[item.y] || []).push(item.text);
      }
    });

    // Slight delay to ensure parsing is complete
    setTimeout(resolve, 1500);
  });

  // Step 4: Sort lines and update metadata in the markdown file
  const fileContent = await readFile(mdPath, "utf8");
  let splitCount = 10;
  const headers = fileContent.split("\n").slice(0, splitCount);
  let lines = fileContent.split("\n").slice(splitCount).filter(Boolean);

  // Sort lines
  lines = lines.sort((a, b) => (a > b ? 1 : -1));

  // Update headers with the current date and record count
  headers.forEach((line, index) => {
    if (line.includes("Son Güncellenme Tarihi:")) {
      headers[
        index
      ] = `## Son Güncellenme Tarihi: ${new Date().toLocaleString()}`;
    }
    if (line.includes("Kayıt Sayısı:")) {
      headers[index] = `## Kayıt Sayısı: ${count}/${totalCount}`;
    }
  });

  const updatedContent = [...headers, ...lines, ''].join("\n");
  await writeFile(mdPath, updatedContent);

  console.log("Markdown file created and updated successfully.");
}

// Run the process
processPDF().catch((err) => console.error(err));
