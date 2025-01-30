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

// Main function
const processPDF = async () => {
  // Step 1: Download PDF
  let response;
  try {
    response = await axios({
      method: "get",
      url: "https://www.btk.gov.tr/uploads/ntsfiles/BXXX.pdf",
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
    })
    .catch((err) => {
      console.error("Error downloading PDF:", err?.response?.status, err?.message, err?.response?.data, err);
    });
  } catch (err) {
    console.error("Error downloading PDF:", err?.response?.status, err?.message, err?.response?.data, err);
    return;
  }

  const pdfPath = "./BXXX.pdf";
  response.data.pipe(fs.createWriteStream(pdfPath));

  await new Promise((resolve) => response.data.on("end", resolve));
  console.log("Downloaded PDF file.");

  // Step 2: Initialize markdown file
  const mdPath = "./README.MD";
  await writeFile(mdPath, "");
  await appendToFile(mdPath,`# Numara Taşınabilirliği Yönlendirme Kodları\n\n`);
  await appendToFile(mdPath, `## Son Güncellenme Tarihi: \n\n`);
  await appendToFile(mdPath, "## Kayıt Sayısı: \n\n");
  await appendToFile(mdPath, "### Kaynak: <https://www.btk.gov.tr/numara-tasinabilirligi-yonlendirme-kodlari> | <https://www.btk.gov.tr/uploads/ntsfiles/BXXX.pdf>\n\n");
  await appendToFile(mdPath,"| Önek | İşletmeci | Durum |\n| --- | --- | --- |\n");

  let rows = {}; // To store rows from the PDF

  // Step 3: Parse the PDF and accumulate rows
  await new Promise((resolve, reject) => {
    new PdfReader().parseFileItems(pdfPath, function (err, item) {
      if (err) reject(err);

      if (!item || item?.page) {
        // End of page, print rows
        const rowStrings = Object.keys(rows)
          .sort((y1, y2) => parseFloat(y1) - parseFloat(y2)) // Sort by Y position
          .map((y) => {
            list.push(jsonFormatter(rows[y]));
            return rowFormatter(rows[y])
          });

        if (rowStrings.length > 0) {
          appendToFile(mdPath, rowStrings.join("")); // Write all rows at once
        }

        rows = {}; // Clear rows for the next page
        if(item?.page) console.log("PAGE:", item?.page);
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

    // Slight delay to ensure parsing is complete
    setTimeout(resolve, 1500);
  });

  // Step 4: Sort lines and update metadata in the markdown file
  const fileContent = await readFile(mdPath, "utf8");
  let splitCount = 10;
  const headers = fileContent.split("\n").slice(0, splitCount);
  let lines = fileContent.split("\n").slice(splitCount).filter(Boolean);

  console.log("Total used records:", count);
  console.log("Total records:", totalCount);
  console.log(`Last updated date:`, lastUpdatedDate);

  // Sort lines
  lines = lines.sort((a, b) => (a > b ? 1 : -1));

  // Update headers with the current date and record count
  headers.forEach((line, index) => {
    if (line.includes("Son Güncellenme Tarihi:")) {
      headers[
        index
      ] = `## Son Güncellenme Tarihi: ${lastUpdatedDate}`;
    }
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
processPDF().catch((err) => console.error(err));
