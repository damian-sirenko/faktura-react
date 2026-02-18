console.log("GMAIL CLIENT VERSION: 2026-01-DEBUG");

/*
  server/mail/gmail.client.cjs
  Gmail OAuth2 client + send mail with PDF attachments
*/

const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");

const OAUTH_PATH = path.join(__dirname, "..", "secrets", "gmail-oauth.json");
const TOKEN_PATH = path.join(__dirname, "..", "secrets", "gmail-token.json");

function encodeSubject(subject) {
  return `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
}

function loadOAuthClient() {
  if (!fs.existsSync(OAUTH_PATH)) {
    throw new Error("gmail-oauth.json not found");
  }

  const raw = JSON.parse(fs.readFileSync(OAUTH_PATH, "utf8"));
  const cfg = raw.installed || raw.web;

  if (!cfg?.client_id || !cfg?.client_secret) {
    throw new Error("Invalid OAuth JSON structure");
  }

  return new google.auth.OAuth2(
    cfg.client_id,
    cfg.client_secret,
    "http://localhost"
  );
}

async function getAuthorizedClient() {
  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error("gmail-token.json not found — authorization required");
  }

  const oauth2Client = loadOAuthClient();
  const token = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
  oauth2Client.setCredentials(token);

  // 🔴 TEMP: швидка перевірка, чи токен ще живий
  try {
    await oauth2Client.getAccessToken();
  } catch (e) {
    console.error("❌ Gmail token invalid — run gmail.auth.cjs");
    throw e;
  }

  return oauth2Client;
}

function chunkBase64(str, size = 76) {
  const chunks = [];
  for (let i = 0; i < str.length; i += size) {
    chunks.push(str.slice(i, i + size));
  }
  return chunks.join("\r\n");
}

async function sendMailRaw({ from, to, subject, html, attachments = [] }) {
  console.log("sendMailRaw called", { from, to, subject, attachments });

  let auth;
  try {
    auth = await getAuthorizedClient();
  } catch (e) {
    console.error("❌ GMAIL AUTH ERROR");
    console.error(e.message || e);
    throw e;
  }

  const gmail = google.gmail({ version: "v1", auth });

  const boundary = "----=_SterylCRM_" + Date.now();
  const parts = [];

  parts.push(
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeSubject(subject)}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset="UTF-8"`,
    `Content-Transfer-Encoding: 7bit`,
    ``,
    html
  );

  for (const filePath of attachments) {
    if (!fs.existsSync(filePath)) continue;

    const filename = path.basename(filePath);
    const fileData = chunkBase64(fs.readFileSync(filePath).toString("base64"));

    parts.push(
      ``,
      `--${boundary}`,
      `Content-Type: application/pdf; name="${filename}"`,
      `Content-Disposition: attachment; filename="${filename}"`,
      `Content-Transfer-Encoding: base64`,
      ``,
      fileData
    );
  }

  parts.push(``, `--${boundary}--`);

  const rawMessage = parts.join("\r\n");

  const encodedMessage = Buffer.from(rawMessage)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  try {
    await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw: encodedMessage },
    });
  } catch (e) {
    console.error("❌ GMAIL API SEND ERROR");
    console.error(e?.response?.data || e?.errors || e?.message || e);
    throw e;
  }
}

module.exports = {
  sendMailRaw,
};
