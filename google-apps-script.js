/**
 * StoneForge — Waitlist sheet + email notify (+ forum emails)
 *
 * DO NOT use Extensions → Apps Script inside a Google Sheet.
 * That menu throws a Google Drive error on this account.
 *
 * Do this instead, logged into dembocom3boys@gmail.com:
 *
 * 1) Open https://script.google.com  (bookmark it)
 * 2) Open your existing StoneForge project, OR click New project
 * 3) Delete the stub, paste THIS whole file, Save
 * 4) Function dropdown → createWaitlistSheet → Run → Allow
 *    Execution log prints the sheet link. Open that link.
 * 5) Deploy → Manage deployments → Edit (pencil) → New version → Deploy
 *    If this is a brand-new project:
 *      Deploy → New deployment → Web app
 *      Execute as: Me
 *      Who has access: Anyone
 *    Paste that URL into config.js → GAS_WEBHOOK_URL
 *
 * Emails send FROM dembocom3boys@gmail.com
 * TO founder@ / info@ / team@ stoneforge.app
 *
 * Sheet columns (created for you):
 *   Timestamp | Email | Name | Position | Referral Code | Referred By | Source
 */

var NOTIFY_EMAILS = [
  "founder@stoneforge.app",
  "info@stoneforge.app",
  "team@stoneforge.app"
];

/** Leave blank. createWaitlistSheet() saves the real ID for you. */
var SHEET_ID = "";

var SHEET_TAB = "Waitlist";

function sheetId_() {
  var saved = PropertiesService.getScriptProperties().getProperty("WAITLIST_SHEET_ID");
  if (saved) return saved;
  if (SHEET_ID) return SHEET_ID;
  return "";
}

function getWaitlistSheet_() {
  var id = sheetId_();
  if (!id) {
    throw new Error("Run createWaitlistSheet once in the Apps Script editor first.");
  }
  var ss = SpreadsheetApp.openById(id);
  var sheet = ss.getSheetByName(SHEET_TAB);
  if (!sheet) sheet = ss.insertSheet(SHEET_TAB);
  ensureHeaders_(sheet);
  return sheet;
}

/**
 * Run this ONCE from script.google.com.
 * Creates "StoneForge Waitlist" in your Drive and remembers the ID.
 */
function createWaitlistSheet() {
  var existing = sheetId_();
  if (existing) {
    var already = SpreadsheetApp.openById(existing);
    ensureHeaders_(already.getSheetByName(SHEET_TAB) || already.insertSheet(SHEET_TAB));
    Logger.log("Sheet already exists: " + already.getUrl());
    return already.getUrl();
  }
  var ss = SpreadsheetApp.create("StoneForge Waitlist");
  var sheet = ss.getSheets()[0];
  sheet.setName(SHEET_TAB);
  ensureHeaders_(sheet);
  PropertiesService.getScriptProperties().setProperty("WAITLIST_SHEET_ID", ss.getId());
  Logger.log("Created sheet: " + ss.getUrl());
  return ss.getUrl();
}

function ensureHeaders_(sheet) {
  var headers = ["Timestamp", "Email", "Name", "Position", "Referral Code", "Referred By", "Source"];
  var row1 = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  var empty = !row1[0];
  if (empty) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
  }
}

/** Same as createWaitlistSheet — kept so an old "setupSheet" run still works */
function setupSheet() {
  var url = createWaitlistSheet();
  Logger.log("OK — " + url);
}

function appendWaitlistRow_(data) {
  var sheet = getWaitlistSheet_();
  sheet.appendRow([
    data.createdAt || new Date().toISOString(),
    data.email || "",
    data.name || "",
    data.position != null ? data.position : "",
    data.referralCode || data.referral_code || "",
    data.referredBy || data.referred_by || "",
    data.source || "website"
  ]);
}

function sendWaitlistEmail_(data) {
  var email = data.email || "unknown";
  var name = data.name || email.split("@")[0] || "Member";
  var position = data.position != null ? String(data.position) : "—";
  var code = data.referralCode || data.referral_code || "";
  var referred = data.referredBy || data.referred_by || "";
  var when = data.createdAt || new Date().toISOString();

  var subject = "WAITLIST JOIN — #" + position + " · " + name + " <" + email + ">";

  var message =
    "WAITLIST JOIN\n" +
    "————————————\n\n" +
    "Someone new joined the StoneForge waitlist.\n\n" +
    "Position: #" + position + "\n" +
    "Name: " + name + "\n" +
    "Email: " + email + "\n" +
    "Referral code: " + (code || "—") + "\n" +
    "Referred by: " + (referred || "—") + "\n" +
    "When: " + when + "\n\n" +
    "————————————\n" +
    "Logged to Google Sheet · StoneForge private beta";

  MailApp.sendEmail({
    to: NOTIFY_EMAILS.join(","),
    subject: subject,
    body: message
  });
}

function sendForumEmail_(data) {
  var type = data.type || "post";
  var title = data.title || "(untitled)";
  var body = data.body || "";
  var author = data.author || "unknown";
  var email = data.email || "";
  var when = data.createdAt || new Date().toISOString();

  var kind =
    type === "question" ? "QUESTION" :
    type === "tip" ? "TIP" :
    type === "admin-reply" ? "ADMIN REPLY" :
    "UPDATE";

  var subject = "FORUM UPDATE — " + kind + " · " + title;

  var message =
    "FORUM UPDATE\n" +
    "————————————\n\n" +
    "Something new hit the trail.\n\n" +
    "Kind: " + kind + "\n" +
    "Author: " + author + (email ? " <" + email + ">" : "") + "\n" +
    "When: " + when + "\n\n" +
    "Title\n" + title + "\n\n" +
    "Message\n" + body + "\n\n" +
    "————————————\n" +
    "StoneForge · private beta";

  MailApp.sendEmail({
    to: NOTIFY_EMAILS.join(","),
    subject: subject,
    body: message
  });
}

function doPost(e) {
  try {
    var raw = (e && e.postData && e.postData.contents) ? e.postData.contents : "{}";
    var data = JSON.parse(raw);
    var kind = String(data.type || data.event || "").toLowerCase();

    if (kind === "waitlist" || kind === "waitlist-join" || kind === "join") {
      try {
        appendWaitlistRow_(data);
      } catch (sheetErr) {
        // Still email even if SHEET_ID isn't set yet
        console.error(sheetErr);
      }
      sendWaitlistEmail_(data);
    } else {
      // forum tip / question / admin-reply / etc.
      sendForumEmail_(data);
    }

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet() {
  return ContentService.createTextOutput("StoneForge waitlist + forum notify OK");
}
