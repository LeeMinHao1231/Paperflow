"use client";

import Script from "next/script";
import { ChangeEvent, useMemo, useRef, useState } from "react";

type GoogleTokenResponse = { access_token?: string; error?: string; error_description?: string };
type GoogleTokenClient = { requestAccessToken: (options?: { prompt?: string }) => void };

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: GoogleTokenResponse) => void;
            error_callback?: (error: unknown) => void;
          }) => GoogleTokenClient;
        };
      };
    };
  }
}

type Destination = "sheets" | "excel";
type Reader = "paddle" | "openai";

type EventDetails = {
  eventName: string;
  date: string;
  time: string;
  venue: string;
};

const initialColumns = [
  "No.",
  "Name",
  "Company Name",
  "Type of Business",
  "Contact Number",
  "Email Address",
  "Visitor Pass Number",
];

const initialRows = [
  ["1", "Aisha Rahman", "Northstar Studio", "Design", "012-345 6789", "aisha@example.com", "V013"],
  ["2", "Daniel Lee", "Brightpath Sdn Bhd", "Consulting", "017-555 0142", "daniel@example.com", "022"],
  ["3", "Mei Tan", "Cedar Works", "Events", "016-901 2234", "mei@example.com", ""],
  ["4", "Arun Kumar", "Kinoko Labs", "Technology", "011-220 7788", "arun@example.com", ""],
];

function downloadCsv(columns: string[], rows: string[][], event: EventDetails) {
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const eventLines = [
    ["Event Name", event.eventName],
    ["Date", event.date],
    ["Time", event.time],
    ["Venue / Region", event.venue],
    [],
  ];
  const csv = [...eventLines, columns, ...rows]
    .map((row) => row.map((cell) => quote(cell ?? "")).join(","))
    .join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${event.eventName || "attendance"}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function Home() {
  const [step, setStep] = useState<"upload" | "review">("upload");
  const [destination, setDestination] = useState<Destination>("sheets");
  const [reader, setReader] = useState<Reader>("paddle");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [isReading, setIsReading] = useState(false);
  const [columns, setColumns] = useState(initialColumns);
  const [rows, setRows] = useState(initialRows);
  const [details, setDetails] = useState<EventDetails>({
    eventName: "BNI Networking Meeting",
    date: "16 July 2026",
    time: "2:00pm – 6:00pm",
    venue: "Cheras",
  });
  const [notice, setNotice] = useState("");
  const [googleReady, setGoogleReady] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const selectedFile = useRef<File | null>(null);
  const googleAccessToken = useRef<string | null>(null);

  const issueCount = useMemo(
    () => rows.flat().filter((value) => value.trim() === "").length,
    [rows],
  );

  function pickImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    selectedFile.current = file;
    setImageUrl(URL.createObjectURL(file));
    setFileName(file.name);
    setNotice("");
  }

  async function readSheet() {
    setIsReading(true);
    setNotice("");
    if (!selectedFile.current) {
      window.setTimeout(() => {
        setIsReading(false);
        setStep("review");
        setNotice("Sample data loaded. Empty cells are highlighted for review.");
      }, 650);
      return;
    }
    try {
      const form = new FormData();
      form.append("image", selectedFile.current);
      form.append("engine", reader);
      const response = await fetch("/api/analyze", { method: "POST", body: form });
      const result = await response.json() as {
        error?: string;
        event?: { name: string; date: string; time: string; venue: string; region: string };
        columns?: string[];
        rows?: string[][];
        warnings?: string[];
      };
      if (!response.ok || !result.event || !result.columns || !result.rows) {
        throw new Error(result.error || "The photo could not be read.");
      }
      setColumns(result.columns);
      setRows(result.rows);
      setDetails({
        eventName: result.event.name,
        date: result.event.date,
        time: result.event.time,
        venue: result.event.venue || result.event.region,
      });
      setIsReading(false);
      setStep("review");
      const warningText = result.warnings?.length ? ` ${result.warnings.join(" ")}` : "";
      setNotice(`${result.columns.length} columns and ${result.rows.length} rows detected. Empty cells are highlighted for review.${warningText}`);
    } catch (error) {
      setIsReading(false);
      setNotice(error instanceof Error ? error.message : "The photo could not be read.");
    }
  }

  function updateCell(rowIndex: number, columnIndex: number, value: string) {
    setRows((current) =>
      current.map((row, r) =>
        r === rowIndex ? row.map((cell, c) => (c === columnIndex ? value : cell)) : row,
      ),
    );
  }

  function updateColumn(index: number, value: string) {
    setColumns((current) => current.map((column, i) => (i === index ? value : column)));
  }

  function addColumn() {
    setColumns((current) => [...current, `New column ${current.length + 1}`]);
    setRows((current) => current.map((row) => [...row, ""]));
  }

  function removeColumn(index: number) {
    if (columns.length === 1) return;
    setColumns((current) => current.filter((_, i) => i !== index));
    setRows((current) => current.map((row) => row.filter((_, i) => i !== index)));
  }

  function addRow() {
    setRows((current) => [...current, columns.map(() => "")]);
  }

  function removeRow(index: number) {
    setRows((current) => current.filter((_, i) => i !== index));
  }

  async function createGoogleSheet(accessToken: string) {
    setIsExporting(true);
    setNotice("Creating a formatted Google Sheet…");
    try {
      const createResponse = await fetch("https://sheets.googleapis.com/v4/spreadsheets", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ properties: { title: details.eventName || "Paperflow attendance" } }),
      });
      if (!createResponse.ok) throw new Error(`Google Sheets returned ${createResponse.status}`);
      const spreadsheet = await createResponse.json() as { spreadsheetId: string; sheets: { properties: { sheetId: number } }[] };
      const values = [
        ["Event Name", details.eventName],
        ["Date", details.date],
        ["Time", details.time],
        ["Venue / Region", details.venue],
        [],
        columns,
        ...rows,
      ];
      const writeResponse = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheet.spreadsheetId}/values/A1?valueInputOption=USER_ENTERED`,
        {
          method: "PUT",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ range: "A1", majorDimension: "ROWS", values }),
        },
      );
      if (!writeResponse.ok) throw new Error(`Google Sheets write returned ${writeResponse.status}`);

      const columnCount = Math.max(columns.length, 2);
      const formatResponse = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheet.spreadsheetId}:batchUpdate`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ requests: [
            { updateSheetProperties: { properties: { sheetId: spreadsheet.sheets[0].properties.sheetId, title: "Attendance", gridProperties: { frozenRowCount: 6 } }, fields: "title,gridProperties.frozenRowCount" } },
            { repeatCell: { range: { sheetId: spreadsheet.sheets[0].properties.sheetId, startRowIndex: 0, endRowIndex: 4, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true }, foregroundColor: { red: .09, green: .25, blue: .19 } } }, fields: "userEnteredFormat(textFormat,foregroundColor)" } },
            { repeatCell: { range: { sheetId: spreadsheet.sheets[0].properties.sheetId, startRowIndex: 5, endRowIndex: 6, startColumnIndex: 0, endColumnIndex: columnCount }, cell: { userEnteredFormat: { backgroundColor: { red: .09, green: .25, blue: .19 }, textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true }, horizontalAlignment: "CENTER" } }, fields: "userEnteredFormat" } },
            { autoResizeDimensions: { dimensions: { sheetId: spreadsheet.sheets[0].properties.sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: columnCount } } },
            { updateBorders: { range: { sheetId: spreadsheet.sheets[0].properties.sheetId, startRowIndex: 5, endRowIndex: 6 + rows.length, startColumnIndex: 0, endColumnIndex: columnCount }, top: { style: "SOLID", colorStyle: { rgbColor: { red: .82, green: .85, blue: .82 } } }, bottom: { style: "SOLID", colorStyle: { rgbColor: { red: .82, green: .85, blue: .82 } } }, left: { style: "SOLID", colorStyle: { rgbColor: { red: .82, green: .85, blue: .82 } } }, right: { style: "SOLID", colorStyle: { rgbColor: { red: .82, green: .85, blue: .82 } } }, innerHorizontal: { style: "SOLID", colorStyle: { rgbColor: { red: .9, green: .92, blue: .9 } } }, innerVertical: { style: "SOLID", colorStyle: { rgbColor: { red: .9, green: .92, blue: .9 } } } } },
          ] }),
        },
      );
      if (!formatResponse.ok) throw new Error(`Google Sheets formatting returned ${formatResponse.status}`);

      const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheet.spreadsheetId}/edit`;
      setNotice("Google Sheet created successfully. Opening it in a new tab…");
      window.open(sheetUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      console.error(error);
      googleAccessToken.current = null;
      setNotice("Google Sheets could not complete the export. Please reconnect and try again.");
    } finally {
      setIsExporting(false);
    }
  }

  function connectAndExportGoogle() {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId || !window.google) {
      setNotice("Google sign-in is not configured yet. Add the public Google client ID and try again.");
      return;
    }
    if (googleAccessToken.current) {
      void createGoogleSheet(googleAccessToken.current);
      return;
    }
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: "https://www.googleapis.com/auth/drive.file",
      callback: (response) => {
        if (!response.access_token) {
          setNotice(response.error_description || "Google sign-in was cancelled.");
          return;
        }
        googleAccessToken.current = response.access_token;
        void createGoogleSheet(response.access_token);
      },
      error_callback: () => setNotice("Google sign-in did not finish. Please allow pop-ups and try again."),
    });
    tokenClient.requestAccessToken({ prompt: "consent" });
  }

  function finishExport() {
    if (destination === "sheets") {
      connectAndExportGoogle();
      return;
    }
    downloadCsv(columns, rows, details);
    setNotice("Excel-compatible file downloaded successfully.");
  }

  return (
    <main>
      <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onLoad={() => setGoogleReady(true)} />
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Paperflow home">
          <span className="brandMark">P</span>
          <span>paperflow</span>
        </a>
        <div className="headerMeta">
          <span className="secureDot" />
          {reader === "paddle" ? "Free local PaddleOCR" : "OpenAI high-accuracy mode"}
        </div>
      </header>

      <section className="hero" id="top">
        <p className="eyebrow">Paper to spreadsheet, without the typing</p>
        <h1>Turn any attendance sheet into clean, editable data.</h1>
        <p className="heroCopy">
          Take a photo, check the handwriting, and send every row to the spreadsheet your team already uses.
        </p>
        <div className="steps" aria-label="Workflow progress">
          <div className={step === "upload" ? "step active" : "step done"}><b>1</b><span>Upload</span></div>
          <i />
          <div className={step === "review" ? "step active" : "step"}><b>2</b><span>Review</span></div>
          <i />
          <div className="step"><b>3</b><span>Export</span></div>
        </div>
      </section>

      {step === "upload" ? (
        <section className="workspace uploadGrid">
          <div className="panel uploadPanel">
            <div className="panelHeading">
              <div><span className="kicker">STEP 1</span><h2>Add your attendance sheet</h2></div>
              <span className="fileRule">JPG, PNG or WEBP · max 12 MB</span>
            </div>
            <button className={`dropzone ${imageUrl ? "hasImage" : ""}`} onClick={() => fileInput.current?.click()}>
              {imageUrl ? (
                <>{imageUrl === "demo" ? <div className="demoSheet" aria-label="Sample attendance sheet preview"><b>EVENT ATTENDANCE</b><span /><span /><span /><span /><span /></div> : <img src={imageUrl} alt="Attendance sheet preview" />}<span className="replaceBadge">Change photo</span></>
              ) : (
                <div className="dropContent">
                  <span className="cameraIcon" aria-hidden="true">◎</span>
                  <strong>Take a photo or choose from your phone</strong>
                  <span>Make sure the full page is visible and well lit</span>
                </div>
              )}
            </button>
            <input ref={fileInput} className="srOnly" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={pickImage} />
            {fileName && <p className="fileName"><span>✓</span>{fileName}</p>}
          </div>

          <div className="panel destinationPanel">
            <div className="panelHeading">
              <div><span className="kicker">DESTINATION</span><h2>Where should the rows go?</h2></div>
            </div>
            <div className="destinationChoices">
              <button className={destination === "sheets" ? "destination active" : "destination"} onClick={() => setDestination("sheets")}>
                <span className="sheetLogo google">▦</span><span><strong>Google Sheets</strong><small>Create a new formatted spreadsheet</small></span><b>{destination === "sheets" ? "●" : "○"}</b>
              </button>
              <button className={destination === "excel" ? "destination active" : "destination"} onClick={() => setDestination("excel")}>
                <span className="sheetLogo excel">X</span><span><strong>Microsoft Excel</strong><small>Save to OneDrive or download</small></span><b>{destination === "excel" ? "●" : "○"}</b>
              </button>
            </div>
            <div className="readerHeading"><span className="kicker">IMAGE READER</span><small>Choose per photo</small></div>
            <div className="readerChoices">
              <button className={reader === "paddle" ? "readerChoice active" : "readerChoice"} onClick={() => setReader("paddle")}>
                <span className="readerBadge local">FREE</span>
                <span><strong>PaddleOCR</strong><small>Private, offline, best for printed text</small></span>
                <b>{reader === "paddle" ? "●" : "○"}</b>
              </button>
              <button className={reader === "openai" ? "readerChoice active" : "readerChoice"} onClick={() => setReader("openai")}>
                <span className="readerBadge cloud">AI</span>
                <span><strong>OpenAI Vision</strong><small>Higher handwriting accuracy, usage charges apply</small></span>
                <b>{reader === "openai" ? "●" : "○"}</b>
              </button>
            </div>
            <div className={`privacyNote ${reader === "openai" ? "cloudNote" : ""}`}>
              <span>{reader === "paddle" ? "⌁" : "☁"}</span>
              <p>
                <strong>{reader === "paddle" ? "The photo stays on this computer." : "The photo is sent securely to OpenAI."}</strong>{" "}
                Paperflow detects each event&apos;s headers and builds matching columns automatically.
              </p>
            </div>
            <button className="primaryButton" disabled={!imageUrl || isReading} onClick={readSheet}>
              {isReading ? <><span className="spinner" /> Reading with {reader === "openai" ? "OpenAI" : "PaddleOCR"}…</> : <>Read this sheet <span>→</span></>}
            </button>
            {notice && <div className="notice uploadNotice"><span>!</span>{notice}<button onClick={() => setNotice("")} aria-label="Dismiss">×</button></div>}
            {!imageUrl && <button className="demoLink" onClick={() => { selectedFile.current = null; setFileName("sample-attendance-sheet.jpeg"); setImageUrl("demo"); }}>Try with sample data</button>}
          </div>
        </section>
      ) : (
        <section className="workspace reviewWorkspace">
          <div className="reviewTopline">
            <div><span className="kicker">STEP 2</span><h2>Check the extracted data</h2><p>Edit any cell before exporting. Blank or uncertain fields are highlighted.</p></div>
            <button className="secondaryButton" onClick={() => setStep("upload")}>← Replace photo</button>
          </div>

          {notice && <div className="notice"><span>✓</span>{notice}<button onClick={() => setNotice("")} aria-label="Dismiss">×</button></div>}

          <div className="eventCard">
            <div className="eventCardHeading"><h3>Event details</h3><span>Detected from page header</span></div>
            <div className="eventFields">
              {([
                ["eventName", "Event name"], ["date", "Date"], ["time", "Time"], ["venue", "Venue / region"],
              ] as [keyof EventDetails, string][]).map(([key, label]) => (
                <label key={key}><span>{label}</span><input value={details[key]} onChange={(e) => setDetails({ ...details, [key]: e.target.value })} /></label>
              ))}
            </div>
          </div>

          <div className="tableCard">
            <div className="tableToolbar">
              <div><h3>Attendance rows</h3><span>{rows.length} rows · {columns.length} columns · <em>{issueCount} empty cells</em></span></div>
              <button onClick={addColumn}>＋ Add column</button>
            </div>
            <div className="tableScroll">
              <table>
                <thead><tr>{columns.map((column, c) => <th key={c}><input value={column} onChange={(e) => updateColumn(c, e.target.value)} aria-label={`Column ${c + 1} name`} /><button onClick={() => removeColumn(c)} aria-label={`Remove ${column}`}>×</button></th>)}<th className="actionColumn" /></tr></thead>
                <tbody>{rows.map((row, r) => <tr key={r}>{columns.map((_, c) => <td key={c} className={!row[c]?.trim() ? "uncertain" : ""}><input value={row[c] ?? ""} onChange={(e) => updateCell(r, c, e.target.value)} aria-label={`Row ${r + 1}, ${columns[c]}`} placeholder="Review" /></td>)}<td className="rowAction"><button onClick={() => removeRow(r)} aria-label={`Remove row ${r + 1}`}>×</button></td></tr>)}</tbody>
              </table>
            </div>
            <button className="addRow" onClick={addRow}>＋ Add attendee row</button>
          </div>

          <div className="exportBar">
            <div className="exportDestination"><span className={`sheetLogo ${destination}`}>{destination === "excel" ? "X" : "▦"}</span><span><small>READY TO EXPORT TO</small><strong>{destination === "excel" ? "Microsoft Excel" : "Google Sheets"}</strong></span><button onClick={() => setStep("upload")}>Change</button></div>
            <button className="primaryButton exportButton" disabled={isExporting || (destination === "sheets" && !googleReady)} onClick={finishExport}>{isExporting ? <><span className="spinner" /> Exporting…</> : <>Approve & export <span>→</span></>}</button>
          </div>
        </section>
      )}

      <footer><span>paperflow prototype</span><span>Photo → Review → Spreadsheet</span></footer>
    </main>
  );
}
