// name of the google sheet- expesne_manager



const PROFILES = {
  "Gopi": { sheet: "gopi", adminSheet: "Gopi_admin" }
};

function getAdminData(adminSheetName) {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(adminSheetName);
  if (cached) return JSON.parse(cached);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(adminSheetName);

  if (!sheet) {
    sheet = ss.insertSheet(adminSheetName);
    sheet.getRange(1, 1, 1, 2).setValues([["password", "0000"]]);
    sheet.getRange(2, 1, 1, 2).setValues([["payment category", "EXPENSE CATEGORY"]]);
  }

  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();

  let pin = "0000";
  if (values.length > 0 && values[0].length > 1) {
    // If the cell contains a number like '0488', Google Sheets treats it as 488.
    // We need to convert it to a string and pad it back to 4 digits.
    pin = String(values[0][1]).trim();
    if (pin.length < 4 && !isNaN(pin)) {
      pin = pin.padStart(4, '0');
    }
  }

  const paidFrom = [];
  const categories = [];

  for (let i = 2; i < values.length; i++) {
    if (values[i][0] && String(values[i][0]).trim() !== "") paidFrom.push(String(values[i][0]).trim());
    if (values[i][1] && String(values[i][1]).trim() !== "") categories.push(String(values[i][1]).trim());
  }

  const result = { pin, paidFrom, categories };
  cache.put(adminSheetName, JSON.stringify(result), 21600); // 6 hours
  return result;
}

function checkAuth(profileName, pinInput) {
  const profile = PROFILES[profileName];
  if (!profile) return { valid: false, error: "Invalid Profile" };

  const adminData = getAdminData(profile.adminSheet);
  if (adminData.pin !== String(pinInput).trim()) {
    return { valid: false, error: "Invalid PIN" };
  }

  return { valid: true, adminData, profile };
}

function setupSheet(profileName) {
  const profile = PROFILES[profileName];
  if (!profile) throw new Error("Invalid profile");

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(profile.sheet);

  if (!sheet) {
    sheet = ss.insertSheet(profile.sheet);
  }

  const headers = sheet.getRange(1, 1, 1, 5).getValues()[0];
  if (headers[0] === "" || headers[0] !== "Date") {
    sheet.getRange(1, 1, 1, 5).setValues([['Date', 'Amount', 'Paid From', 'Category', 'Description']]);
    sheet.getRange(1, 1, 1, 5).setFontWeight("bold");
  }

  return sheet;
}

function doGet(e) {
  const profileName = e.parameter.profile;
  const pin = e.parameter.pin;

  const auth = checkAuth(profileName, pin);
  if (!auth.valid) {
    return ContentService.createTextOutput(JSON.stringify({ error: auth.error, status: "error" }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (e.parameter.action && e.parameter.action !== 'read') {
    return doPost(e);
  }

  try {
    const sheet = setupSheet(profileName);
    const dataRange = sheet.getDataRange();
    const values = dataRange.getValues();

    const data = [];
    if (values.length > 1) {
      const headers = values[0];
      for (let i = 1; i < values.length; i++) {
        const row = values[i];
        if (!row[0] || String(row[0]).trim() === "") continue; // Skip empty rows (e.g. from formatting artifacts)
        
        const obj = { row: i + 1 };
        for (let j = 0; j < headers.length; j++) {
          obj[headers[j]] = row[j];
        }
        data.push(obj);
      }
    }

    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      data: data,
      settings: {
        paidFrom: auth.adminData.paidFrom,
        categories: auth.adminData.categories
      }
    })).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", error: error.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  try {
    let requestData;
    if (e.postData && e.postData.contents) {
      requestData = JSON.parse(e.postData.contents);
    } else {
      requestData = e.parameter;
    }

    const auth = checkAuth(requestData.profile, requestData.pin);
    if (!auth.valid) {
      return ContentService.createTextOutput(JSON.stringify({ error: auth.error, status: "error" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const { action } = requestData;
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    if (action === 'change_password') {
      const { new_pin } = requestData;
      const adminSheet = ss.getSheetByName(auth.profile.adminSheet);
      adminSheet.getRange(1, 2).setValue(new_pin);
      CacheService.getScriptCache().remove(auth.profile.adminSheet);
      return ContentService.createTextOutput(JSON.stringify({ status: "success", message: "Password updated successfully" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'add_setting' || action === 'delete_setting') {
      const { setting_type, value } = requestData;
      const adminSheet = ss.getSheetByName(auth.profile.adminSheet);
      const col = setting_type === 'paid_from' ? 1 : 2;

      const numRows = Math.max(adminSheet.getLastRow(), 3);
      const range = adminSheet.getRange(3, col, numRows - 2, 1);
      const values = range.getValues();
      let arr = values.map(r => r[0]).filter(v => v !== "");

      if (action === 'add_setting') {
        if (!arr.includes(value)) arr.push(value);
      } else {
        arr = arr.filter(v => String(v).trim() !== String(value).trim());
      }

      range.clearContent();
      if (arr.length > 0) {
        adminSheet.getRange(3, col, arr.length, 1).setValues(arr.map(v => [v]));
      }

      CacheService.getScriptCache().remove(auth.profile.adminSheet);
      return ContentService.createTextOutput(JSON.stringify({ status: "success", message: "Setting updated" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Existing expense logic
    const sheet = setupSheet(requestData.profile);
    const { date, amount, paidFrom, category, description } = requestData;
    const row = requestData.row ? parseInt(requestData.row, 10) : null;

    if (action === 'full_sync') {
      const expenses = requestData.expenses || [];
      const settings = requestData.settings || { paidFrom: [], categories: [] };
      
      sheet.clear();
      sheet.appendRow(['Date', 'Amount', 'Paid From', 'Category', 'Description']);
      sheet.getRange(1, 1, 1, 5).setFontWeight("bold");
      
      const rows = expenses.map(exp => [
        exp.Date, exp.Amount, exp['Paid From'], exp.Category, exp.Description
      ]);
      if (rows.length > 0) {
        sheet.getRange(2, 1, rows.length, 5).setValues(rows);
      }
      
      // Update settings
      const adminSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(auth.profile.adminSheet);
      const pfRange = adminSheet.getRange(3, 1, Math.max(1, adminSheet.getMaxRows() - 2), 1);
      pfRange.clearContent();
      if (settings.paidFrom.length > 0) {
        adminSheet.getRange(3, 1, settings.paidFrom.length, 1).setValues(settings.paidFrom.map(v => [v]));
      }
      const catRange = adminSheet.getRange(3, 2, Math.max(1, adminSheet.getMaxRows() - 2), 1);
      catRange.clearContent();
      if (settings.categories.length > 0) {
        adminSheet.getRange(3, 2, settings.categories.length, 1).setValues(settings.categories.map(v => [v]));
      }
      CacheService.getScriptCache().remove(auth.profile.adminSheet);
      
      return ContentService.createTextOutput(JSON.stringify({ status: "success", message: "Sync complete" }))
        .setMimeType(ContentService.MimeType.JSON);
    } else if (action === 'edit' && row) {
      if (row > sheet.getMaxRows() || row < 2) {
         return ContentService.createTextOutput(JSON.stringify({ status: "error", error: "Row out of bounds for edit. Please refresh." }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      sheet.getRange(row, 1, 1, 5).setValues([[date, amount, paidFrom, category, description]]);
      return ContentService.createTextOutput(JSON.stringify({ status: "success", message: "Expense updated successfully" }))
        .setMimeType(ContentService.MimeType.JSON);
    } else if (action === 'delete' && row) {
      let targetRow = row;
      const data = sheet.getDataRange().getValues();
      
      const isMatch = (rIdx) => {
        if (rIdx <= 1 || rIdx > data.length) return false;
        const r = data[rIdx - 1];
        
        let sheetDate = r[0];
        if (sheetDate instanceof Date) {
          try {
            sheetDate = Utilities.formatDate(sheetDate, Session.getScriptTimeZone(), "yyyy-MM-dd");
          } catch(e) {}
        }
        
        const dateStr = date ? String(date).substring(0, 10) : "";
        const sheetDateStr = String(sheetDate).substring(0, 10);
        
        const dateMatch = !date || sheetDateStr === dateStr;
        const amtMatch = !amount || String(r[1]).trim() === String(amount).trim();
        const catMatch = !category || String(r[3]).trim().toLowerCase() === String(category).trim().toLowerCase();
        const descMatch = !description || String(r[4]).trim().toLowerCase() === String(description).trim().toLowerCase();
        
        return amtMatch && catMatch && descMatch;
      };

      if (!isMatch(targetRow)) {
        targetRow = -1;
        // Search bottom-up to find the most recent match
        for (let i = data.length; i >= 2; i--) {
          if (isMatch(i)) {
            targetRow = i;
            break;
          }
        }
      }

      if (targetRow !== -1) {
        sheet.deleteRow(targetRow);
        return ContentService.createTextOutput(JSON.stringify({ status: "success", message: "Expense deleted successfully" }))
          .setMimeType(ContentService.MimeType.JSON);
      } else {
        const r = (row > 1 && row <= data.length) ? data[row-1] : [];
        const debugStr = `Row: ${row}, Amt: ${amount} vs ${r[1]}, Cat: ${category} vs ${r[3]}, Desc: ${description} vs ${r[4]}`;
        return ContentService.createTextOutput(JSON.stringify({ status: "error", error: "Could not locate expense. " + debugStr }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    } else {
      sheet.appendRow([date, amount, paidFrom, category, description]);
      return ContentService.createTextOutput(JSON.stringify({ status: "success", message: "Expense added successfully" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", error: error.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
