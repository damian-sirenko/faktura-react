/*
  server.routes.protocols.cjs
  Protocols feature module:
  - DB-backed protocols + entries (read/write/update/move)
  - signatures storage to /signatures (including default staff signature)
  - queue flags (courier/point) + sign-queue-db listing
  - protocol PDF + ZIP exports
  - debug endpoints for protocols DB
*/

const fs = require("fs");
const path = require("path");

const { query: sql } = require("./server/db.js");
const clientsRepo = require("./server/repos/clientsRepo.js");

const {
  fetchFn,
  ROOT,
  SIGNATURES_DIR,
  safeSeg,
  toISO10,
  parseJSON,
  nowForSQL,
  todayLocalISO,
  ymFromISO,
  slugFromName,
  deriveInitialQueue,
  refreshDefaultStaffSignaturePublic,
  getDefaultStaffSignaturePublic,
} = require("./server.shared.cjs");

const { createProtocolPDF, createProtocolZip } = require("./protocol.pdf.js");
const { authRequired } = require("./backend/middleware/auth");

module.exports = function mountProtocolsRoutes(app) {
  const AUTH_DISABLE_DEV = process.env.AUTH_DISABLE_DEV === "1";
  const authGuard = AUTH_DISABLE_DEV
    ? (_req, _res, next) => next()
    : authRequired;

  async function dbGetClientById(clientId) {
    const [row] = await sql(
      `SELECT id, name, address, nip, pesel, logistics
         FROM clients
         WHERE id=?
         LIMIT 1`,
      [clientId]
    );
    return row || { id: clientId, name: clientId };
  }

  async function protocolPdfToBuffer({ client, proto, onlySigned = false }) {
    const { PassThrough } = require("stream");

    const chunks = [];
    const resLike = new PassThrough();

    resLike.setHeader = () => {};
    resLike.status = () => ({ send: () => {} });
    resLike.send = () => {};

    resLike.on("data", (c) => chunks.push(c));

    const done = new Promise((resolve, reject) => {
      resLike.on("finish", resolve);
      resLike.on("end", resolve);
      resLike.on("close", resolve);
      resLike.on("error", reject);
    });

    await Promise.resolve(
      createProtocolPDF({
        res: resLike,
        client,
        proto,
        onlySigned: !!onlySigned,
      })
    );

    await done;

    const buf = Buffer.concat(chunks);
    return buf;
  }

  async function dbListProtocolsWithEntriesLite() {
    const rows = await sql(`
    SELECT
  p.id        AS protocolId,
  p.clientId  AS clientId,
  p.month     AS month,
  p.summarized AS summarized,
  p.createdAt AS createdAt,
  p.updatedAt AS updatedAt,
  e.date      AS e_date,
  e.packages  AS e_packages,
  e.delivery  AS e_delivery,
  e.shipping  AS e_shipping,
  e.returnDate AS e_returnDate
      FROM protocols p
      LEFT JOIN protocol_entries e ON e.protocol_id = p.id
      ORDER BY p.month DESC, p.clientId ASC, e.date ASC, e.id ASC
    `);

    if (!rows.length) return [];

    const byProto = new Map();
    for (const r of rows) {
      if (!byProto.has(r.protocolId)) {
        byProto.set(r.protocolId, {
          id: r.clientId,
          month: r.month,
          summarized: !!r.summarized,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          entries: [],
        });
      }
      if (r.e_date == null && r.e_packages == null) continue;

      byProto.get(r.protocolId).entries.push({
        date: toISO10(r.e_date),
        packages: Number(r.e_packages ?? 0) || 0,
        delivery: r.e_delivery || null,
        shipping: !!r.e_shipping,
        tools: [],
        returnDate: toISO10(r.e_returnDate),
      });      
    }

    return Array.from(byProto.values());
  }

  async function dbGetProtocolFull(clientId, month) {
    const [proto] = await sql(
      `
        SELECT
          p.id         AS protocolId,
          p.clientId   AS clientId,
          p.month      AS month,
          p.summarized AS summarized,
          p.createdAt  AS createdAt,
          p.updatedAt  AS updatedAt
        FROM protocols p
        WHERE p.clientId=? AND p.month=?
        LIMIT 1
      `,
      [clientId, month]
    );

    if (!proto) {
      return {
        id: clientId,
        month,
        summarized: false,
        entries: [],
        totals: { totalPackages: 0 },
      };
    }

    let entriesRows = [];
    const fullSelect = `
        SELECT
          e.id                 AS entryId,
          e.date               AS date,
          e.packages           AS packages,
          e.delivery           AS delivery,
          e.shipping           AS shipping,
          e.comment            AS comment,
          e.tools_json         AS tools_json,
          e.signatures_json    AS signatures_json,
          e.courierPending     AS courierPending,
          e.pointPending       AS pointPending,
          e.courierPlannedDate AS courierPlannedDate,
          e.returnDate         AS returnDate,
          e.returnPackages     AS returnPackages,
          e.returnDelivery     AS returnDelivery,
          e.returnShipping     AS returnShipping,
          e.returnTools_json   AS returnTools_json,
          e.transferClientSig  AS transferClientSig,
          e.transferStaffSig   AS transferStaffSig,
          e.returnClientSig    AS returnClientSig,
          e.returnStaffSig     AS returnStaffSig,
          e.queue_json         AS queue_json
        FROM protocol_entries e
        WHERE e.protocol_id=?
        ORDER BY e.date ASC, e.id ASC
    `;
    const midSelect = `
        SELECT
          e.id               AS entryId,
          e.date             AS date,
          e.packages         AS packages,
          e.delivery         AS delivery,
          e.shipping         AS shipping,
          e.comment          AS comment,
          e.tools_json       AS tools_json,
          e.signatures_json  AS signatures_json
        FROM protocol_entries e
        WHERE e.protocol_id=?
        ORDER BY e.date ASC, e.id ASC
    `;
    const minSelect = `
        SELECT
          e.id       AS entryId,
          e.date     AS date,
          e.packages AS packages,
          e.delivery AS delivery,
          e.shipping AS shipping,
          e.comment  AS comment
        FROM protocol_entries e
        WHERE e.protocol_id=?
        ORDER BY e.date ASC, e.id ASC
    `;

    try {
      entriesRows = await sql(fullSelect, [proto.protocolId]);
    } catch {
      try {
        entriesRows = await sql(midSelect, [proto.protocolId]);
      } catch {
        entriesRows = await sql(minSelect, [proto.protocolId]);
      }
    }

    const entries = entriesRows.map((r) => {
      const tools = r.hasOwnProperty("tools_json")
        ? parseJSON(r.tools_json, [])
        : [];

      let signatures = r.hasOwnProperty("signatures_json")
        ? parseJSON(r.signatures_json, {})
        : {};
      if (
        (!signatures || !Object.keys(signatures).length) &&
        (r.transferClientSig ||
          r.transferStaffSig ||
          r.returnClientSig ||
          r.returnStaffSig)
      ) {
        signatures = {};
        if (r.transferClientSig || r.transferStaffSig) {
          signatures.transfer = {};
          if (r.transferClientSig)
            signatures.transfer.client = r.transferClientSig;
          if (r.transferStaffSig)
            signatures.transfer.staff = r.transferStaffSig;
        }
        if (r.returnClientSig || r.returnStaffSig) {
          signatures.return = {};
          if (r.returnClientSig) signatures.return.client = r.returnClientSig;
          if (r.returnStaffSig) signatures.return.staff = r.returnStaffSig;
        }
      }

      let queue = {};
      if (r && r.hasOwnProperty("queue_json")) {
        const q = parseJSON(r.queue_json, null);
        if (q && typeof q === "object") {
          queue = {
            courierPending: !!q.courierPending,
            pointPending: !!q.pointPending,
            courierPlannedDate: toISO10(q.courierPlannedDate),
          };
        }
      }
      if (
        !Object.keys(queue).length &&
        (r.hasOwnProperty("courierPending") || r.hasOwnProperty("pointPending"))
      ) {
        queue = {
          courierPending: !!r.courierPending,
          pointPending: !!r.pointPending,
          courierPlannedDate: toISO10(r.courierPlannedDate),
        };
      }

      const ret = {
        returnDate: r.hasOwnProperty("returnDate")
          ? toISO10(r.returnDate)
          : null,
        returnPackages: r.hasOwnProperty("returnPackages")
          ? r.returnPackages ?? null
          : null,
        returnDelivery: r.hasOwnProperty("returnDelivery")
          ? r.returnDelivery || null
          : null,
        returnShipping: r.hasOwnProperty("returnShipping")
          ? !!r.returnShipping
          : false,
        returnTools: r.hasOwnProperty("returnTools_json")
          ? parseJSON(r.returnTools_json, [])
          : [],
      };

      return {
        entryId: r.entryId,
        date: toISO10(r.date),
        packages: Number(r.packages || 0) || 0,
        delivery: r.delivery || null,
        shipping: !!r.shipping,
        comment: r.comment || "",
        tools,
        signatures,
        queue,
        ...ret,
      };
    });

    const totalPackages = entries.reduce(
      (sum, e) => sum + (Number(e.packages || 0) || 0),
      0
    );

    return {
      id: proto.clientId,
      month: proto.month,
      summarized: !!proto.summarized,
      entries,
      totals: { totalPackages },
    };
  }

  async function dbEnsureProtocolHeader(clientId, month) {
    const existing = await sql(
      `SELECT id FROM protocols WHERE clientId=? AND month=? LIMIT 1`,
      [clientId, month]
    );

    if (existing.length) {
      await sql(`UPDATE protocols SET updatedAt=? WHERE id=?`, [
        nowForSQL(),
        existing[0].id,
      ]);
      return existing[0].id;
    } else {
      const now = nowForSQL();
      const result = await sql(
        `
          INSERT INTO protocols (clientId, month, summarized, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?)
        `,
        [clientId, month, 0, now, now]
      );
      return result.insertId;
    }
  }

  async function dbUpsertEntry({ protocolId, index, newEntry }) {
    const rows = await sql(
      `
        SELECT e.id
        FROM protocol_entries e
        WHERE e.protocol_id=?
        ORDER BY e.date ASC, e.id ASC
      `,
      [protocolId]
    );

    const isUpdate =
      Number.isInteger(index) && index >= 0 && index < rows.length;

    if (isUpdate) {
      const targetId = rows[index].id;

      const fullSQL = `
        UPDATE protocol_entries
        SET
          date=?,
          packages=?,
          delivery=?,
          shipping=?,
          comment=?,
          tools_json=?,
          signatures_json=?,
          courierPending=?,
          pointPending=?,
          courierPlannedDate=?,
          returnDate=?,
          returnPackages=?,
          returnDelivery=?,
          returnShipping=?,
          returnTools_json=?
        WHERE id=?
      `;
      const fullParams = [
        newEntry.date,
        newEntry.packages,
        newEntry.delivery,
        newEntry.shipping ? 1 : 0,
        newEntry.comment,
        JSON.stringify(newEntry.tools || []),
        JSON.stringify(newEntry.signatures || {}),
        newEntry.queue?.courierPending ? 1 : 0,
        newEntry.queue?.pointPending ? 1 : 0,
        newEntry.queue?.courierPlannedDate || null,
        newEntry.returnDate || null,
        newEntry.returnPackages ?? null,
        newEntry.returnDelivery || null,
        newEntry.returnShipping ? 1 : 0,
        JSON.stringify(newEntry.returnTools || []),
        targetId,
      ];

      try {
        await sql(fullSQL, fullParams);
      } catch (err) {
        console.warn(
          "⚠️ FULL UPDATE failed, fallback to BASIC UPDATE",
          err?.sqlMessage || err
        );
        await sql(
          `
            UPDATE protocol_entries
            SET
              date=?,
              packages=?,
              delivery=?,
              shipping=?,
              comment=?,
              tools_json=?,
              signatures_json=?
            WHERE id=?
          `,
          [
            newEntry.date,
            newEntry.packages,
            newEntry.delivery,
            newEntry.shipping ? 1 : 0,
            newEntry.comment,
            JSON.stringify(newEntry.tools || []),
            JSON.stringify(newEntry.signatures || {}),
            targetId,
          ]
        );
      }

      return targetId;
    }

    const fullInsertSQL = `
      INSERT INTO protocol_entries (
        protocol_id,
        date,
        packages,
        delivery,
        shipping,
        comment,
        tools_json,
        signatures_json,
        courierPending,
        pointPending,
        courierPlannedDate,
        returnDate,
        returnPackages,
        returnDelivery,
        returnShipping,
        returnTools_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const fullInsertParams = [
      protocolId,
      newEntry.date,
      newEntry.packages,
      newEntry.delivery,
      newEntry.shipping ? 1 : 0,
      newEntry.comment,
      JSON.stringify(newEntry.tools || []),
      JSON.stringify(newEntry.signatures || {}),
      newEntry.queue?.courierPending ? 1 : 0,
      newEntry.queue?.pointPending ? 1 : 0,
      newEntry.queue?.courierPlannedDate || null,
      newEntry.returnDate || null,
      newEntry.returnPackages ?? null,
      newEntry.returnDelivery || null,
      newEntry.returnShipping ? 1 : 0,
      JSON.stringify(newEntry.returnTools || []),
    ];

    try {
      const result = await sql(fullInsertSQL, fullInsertParams);
      return result.insertId;
    } catch (err) {
      console.warn(
        "⚠️ FULL INSERT failed, fallback to BASIC INSERT",
        err?.sqlMessage || err
      );
      const basicResult = await sql(
        `
          INSERT INTO protocol_entries (
            protocol_id,
            date,
            packages,
            delivery,
            shipping,
            comment,
            tools_json,
            signatures_json
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          protocolId,
          newEntry.date,
          newEntry.packages,
          newEntry.delivery,
          newEntry.shipping ? 1 : 0,
          newEntry.comment,
          JSON.stringify(newEntry.tools || []),
          JSON.stringify(newEntry.signatures || {}),
        ]
      );
      return basicResult.insertId;
    }
  }

  async function dbDeleteEntryByIndex(clientId, month, index) {
    const [proto] = await sql(
      `SELECT id FROM protocols WHERE clientId=? AND month=? LIMIT 1`,
      [clientId, month]
    );
    if (!proto) return false;

    const rows = await sql(
      `
        SELECT e.id
        FROM protocol_entries e
        WHERE e.protocol_id=?
        ORDER BY e.date ASC, e.id ASC
      `,
      [proto.id]
    );
    if (!Number.isInteger(index) || index < 0 || index >= rows.length) {
      return false;
    }
    const entryId = rows[index].id;
    await sql(`DELETE FROM protocol_entries WHERE id=?`, [entryId]);
    return true;
  }

  async function dbSetSummarized(clientId, month, summarized) {
    await dbEnsureProtocolHeader(clientId, month);
    await sql(
      `UPDATE protocols SET summarized=?, updatedAt=? WHERE clientId=? AND month=?`,
      [summarized ? 1 : 0, nowForSQL(), clientId, month]
    );
  }

  function computeMonthlyTotals(proto) {
    const totalPackages = (proto.entries || []).reduce(
      (sum, e) => sum + (Number(e.packages || 0) || 0),
      0
    );
    return { totalPackages };
  }

  function isISODate(s) {
    return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  }

  function todayISO() {
    return todayLocalISO();
  }

  async function dbGetAllClientsIndex() {
    const rows = await clientsRepo.getAllClients();
    const idx = {};
    for (const c of rows) {
      const name =
        c?.name ||
        c?.Klient ||
        c?.client ||
        c?.Client ||
        c?.buyer_name ||
        c?.Buyer ||
        "";
      const id = c?.id || c?.ID || slugFromName(name);
      if (id) {
        idx[id] = {
          name: name || id,
          logistics: c?.logistics || "",
        };
      }
    }
    return idx;
  }

  app.get("/protocols", async (_req, res) => {
    try {
      const list = await dbListProtocolsWithEntriesLite();
      return res.json(Array.isArray(list) ? list : []);
    } catch (e) {
      console.error("❌ Error reading protocols list:", e);
      res.status(500).json({ error: "Failed to load protocols list" });
    }
  });

  app.get("/protocols/:month/zip", (req, res) => {
    Promise.resolve(createProtocolZip(req, res)).catch((e) => {
      console.error("❌ PDF zip error:", e);
      if (!res.headersSent) res.status(500).send("ZIP generation error");
    });
  });

  app.get("/protocols/:clientId/:month/pdf", (req, res) => {
    Promise.resolve(createProtocolPDF(req, res)).catch((e) => {
      console.error("❌ PDF protocol error:", e);
      if (!res.headersSent) res.status(500).send("PDF generation error");
    });
  });

  app.post("/protocols/zip", async (req, res) => {
    try {
      const { pairs, onlySigned } = req.body || {};
      if (!Array.isArray(pairs) || !pairs.length) {
        return res.status(400).json({ error: "pairs required" });
      }

      const archiver = require("archiver");
      const archive = archiver("zip", { zlib: { level: 9 } });

      res.attachment(`protokoly_${Date.now()}.zip`);
      archive.pipe(res);

      for (const p of pairs) {
        const clientId = p?.clientId;
        const month = p?.month;

        if (!clientId || !/^\d{4}-\d{2}$/.test(month)) continue;

        const client = await dbGetClientById(clientId);
        const protoDb = await dbGetProtocolFull(clientId, month);
        if (!protoDb?.entries?.length) continue;

        const proto = {
          id: clientId,
          month,
          summarized: !!protoDb.summarized,
          entries: Array.isArray(protoDb.entries) ? protoDb.entries : [],
        };

        const pdfBuf = await protocolPdfToBuffer({
          client,
          proto,
          onlySigned: !!onlySigned,
        });

        if (!pdfBuf || pdfBuf.length < 1000) continue;

        const clientIdUpper = safeSeg(clientId).toUpperCase();

        archive.append(pdfBuf, {
          name: `Protokol_${clientIdUpper}_${month}${
            onlySigned ? "_podpisane" : ""
          }.pdf`,
        });
      }

      await archive.finalize();
    } catch (e) {
      console.error("POST /protocols/zip error:", e);
      if (!res.headersSent) res.status(500).end();
    }
  });

  app.get("/protocols/:clientId/:month", async (req, res) => {
    try {
      const clientId = decodeURIComponent(req.params.clientId);
      const month = req.params.month;
      if (!/^\d{4}-\d{2}$/.test(month)) {
        return res.status(400).json({ error: "Invalid month format" });
      }

      const proto = await dbGetProtocolFull(clientId, month);
      res.json(proto);
    } catch (e) {
      console.error("❌ Error reading protocol (DB):", e);
      res.status(500).json({ error: "Failed to load protocol" });
    }
  });

  app.post("/protocols/:clientId/:month", async (req, res) => {
    try {
      const { clientId, month } = req.params;
      if (!/^\d{4}-\d{2}$/.test(month)) {
        return res.status(400).json({ error: "Invalid month format" });
      }

      const entry = req.body || {};
      const date = entry.date ? String(entry.date) : null;
      if (!date) {
        return res.status(400).json({ error: "Brak 'date' w wpisie" });
      }

      const tools = Array.isArray(entry.tools)
        ? entry.tools.map((t) => ({
            name: String(t?.name || "").trim(),
            count: Number(t?.count || 0) || 0,
          }))
        : [];

      const packages = Number(entry.packages || 0) || 0;
      const delivery = entry.delivery || null;
      const shipping = !!entry.shipping;
      const comment = String(entry.comment || "");

      function saveSignatureDataURL(dataURL, roleKey) {
        if (!dataURL || typeof dataURL !== "string") return null;
        const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(
          dataURL
        );
        if (!m) return null;
        const ext = m[1] === "jpeg" ? "jpg" : "png";
        const b64 = m[2];

        const dir = path.join(
          SIGNATURES_DIR,
          safeSeg(clientId),
          safeSeg(month)
        );
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const file = `${roleKey}_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 8)}.${ext}`;
        const abs = path.join(dir, file);
        fs.writeFileSync(abs, Buffer.from(b64, "base64"));
        const pub = `/signatures/${encodeURIComponent(
          safeSeg(clientId)
        )}/${encodeURIComponent(safeSeg(month))}/${encodeURIComponent(file)}`;
        return pub;
      }

      let signatures;
      if (entry.signaturesData && typeof entry.signaturesData === "object") {
        const sd = entry.signaturesData;
        const transfer = {};
        const ret = {};
        if (sd.transfer && typeof sd.transfer === "object") {
          if (sd.transfer.client) {
            transfer.client = saveSignatureDataURL(
              sd.transfer.client,
              "transfer_client"
            );
          }
          if (sd.transfer.staff) {
            transfer.staff = saveSignatureDataURL(
              sd.transfer.staff,
              "transfer_staff"
            );
          }
        }
        if (sd.return && typeof sd.return === "object") {
          if (sd.return.client) {
            ret.client = saveSignatureDataURL(
              sd.return.client,
              "return_client"
            );
          }
          if (sd.return.staff) {
            ret.staff = saveSignatureDataURL(sd.return.staff, "return_staff");
          }
        }
        const hasTransfer = transfer.client || transfer.staff;
        const hasReturn = ret.client || ret.staff;
        if (hasTransfer || hasReturn) {
          signatures = {};
          if (hasTransfer) signatures.transfer = transfer;
          if (hasReturn) signatures.return = ret;
        }
      }

      const clientsIdx = await dbGetAllClientsIndex();
      const cli = clientsIdx[clientId] || {};
      let queue = deriveInitialQueue(cli.logistics || "");

      if (queue.courierPending) {
        const plannedRaw =
          (typeof entry.courierPlannedDate === "string" &&
            /^\d{4}-\d{2}-\d{2}$/.test(entry.courierPlannedDate) &&
            entry.courierPlannedDate) ||
          (isISODate(date) && date) ||
          todayISO();

        queue.courierPlannedDate = plannedRaw;
        queue.pointPending = false;
      }

      if (queue.pointPending) {
        queue.courierPending = false;
        delete queue.courierPlannedDate;
      }

      const newEntry = {
        date,
        tools,
        packages,
        delivery,
        shipping,
        comment,
        signatures,
        queue,
      };

      const editIndex = Number(entry._editIndex);

      const protocolId = await dbEnsureProtocolHeader(clientId, month);
      await dbUpsertEntry({
        protocolId,
        index: Number.isInteger(editIndex) ? editIndex : null,
        newEntry,
      });

      const protoFull = await dbGetProtocolFull(clientId, month);
      res.json({ success: true, protocol: protoFull });
    } catch (e) {
      console.error("❌ Error saving protocol (DB):", e);
      res.status(500).json({ error: "Failed to save protocol entry" });
    }
  });

  app.delete("/protocols/:clientId/:month/:index", async (req, res) => {
    try {
      const { clientId, month, index } = req.params;
      const idx = Number(index);

      const ok = await dbDeleteEntryByIndex(clientId, month, idx);
      if (!ok) {
        return res.status(404).json({ error: "Protocol or entry not found" });
      }

      const protoFull = await dbGetProtocolFull(clientId, month);
      res.json({ success: true, protocol: protoFull });
    } catch (e) {
      console.error("❌ Error deleting protocol entry (DB):", e);
      res.status(500).json({ error: "Failed to delete protocol entry" });
    }
  });

  app.post("/protocols/:clientId/:month/:index/queue", async (req, res) => {
    try {
      const { clientId, month, index } = req.params;
      const { type, pending } = req.body || {};
      if (!["courier", "point"].includes(type)) {
        return res.status(400).json({ error: "Invalid type" });
      }
      const idx = Number(index);

      const protoFull = await dbGetProtocolFull(clientId, month);
      const entry = protoFull.entries[idx];
      if (!entry) {
        return res.status(404).json({ error: "Entry not found" });
      }

      entry.queue = entry.queue || {
        courierPending: false,
        pointPending: false,
        courierPlannedDate: null,
      };
      if (type === "courier") entry.queue.courierPending = !!pending;
      if (type === "point") entry.queue.pointPending = !!pending;

      const protocolId = await dbEnsureProtocolHeader(clientId, month);
      await dbUpsertEntry({
        protocolId,
        index: idx,
        newEntry: entry,
      });

      const after = await dbGetProtocolFull(clientId, month);
      res.json({ success: true, entry: after.entries[idx] });
    } catch (e) {
      console.error("❌ Queue set error (DB):", e);
      res.status(500).json({ error: "Failed to set queue flag" });
    }
  });

  app.delete("/protocols/:clientId/:month/:index/queue", async (req, res) => {
    try {
      const { clientId, month, index } = req.params;
      const type =
        (req.body && req.body.type) || (req.query && req.query.type) || "";
      if (!["courier", "point"].includes(type)) {
        return res
          .status(400)
          .json({ error: "type must be 'courier' or 'point'" });
      }

      const idx = Number(index);

      const protoFull = await dbGetProtocolFull(clientId, month);
      const entry = protoFull.entries[idx];
      if (!entry) {
        return res.status(404).json({ error: "Entry not found" });
      }

      entry.queue = entry.queue || {
        courierPending: false,
        pointPending: false,
        courierPlannedDate: null,
      };
      if (type === "courier") entry.queue.courierPending = false;
      if (type === "point") entry.queue.pointPending = false;

      const protocolId = await dbEnsureProtocolHeader(clientId, month);
      await dbUpsertEntry({
        protocolId,
        index: idx,
        newEntry: entry,
      });

      const after = await dbGetProtocolFull(clientId, month);
      res.json({ success: true, entry: after.entries[idx] });
    } catch (e) {
      console.error("❌ Queue clear error (DB):", e);
      res.status(500).json({ error: "Failed to clear queue flag" });
    }
  });

  app.post("/protocols/:clientId/:month/:index/sign", async (req, res) => {
    try {
      const { clientId, month, index } = req.params;
      const {
        leg,
        client: clientDataURL,
        staff: staffDataURL,
        useDefaultStaff,
      } = req.body || {};

      if (!["transfer", "return"].includes(leg)) {
        return res.status(400).json({ error: "Invalid leg" });
      }

      const idx = Number(index);
      const protoFull = await dbGetProtocolFull(clientId, month);
      const entry = protoFull.entries[idx];
      if (!entry) {
        return res.status(404).json({ error: "Entry not found" });
      }

      function saveSignatureDataURLStrict(dataURL, roleKey) {
        if (!dataURL || typeof dataURL !== "string")
          throw new Error("Invalid signature payload");
        const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(
          dataURL
        );
        if (!m) throw new Error("Invalid image dataURL");
        const ext = m[1] === "jpeg" ? "jpg" : "png";
        const b64 = m[2];

        const dir = path.join(
          SIGNATURES_DIR,
          safeSeg(clientId),
          safeSeg(month)
        );
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const file = `${roleKey}_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 8)}.${ext}`;
        const abs = path.join(dir, file);
        fs.writeFileSync(abs, Buffer.from(b64, "base64"));
        const pub = `/signatures/${encodeURIComponent(
          safeSeg(clientId)
        )}/${encodeURIComponent(safeSeg(month))}/${encodeURIComponent(file)}`;
        return pub;
      }

      entry.signatures = entry.signatures || {};
      entry.signatures[leg] = entry.signatures[leg] || {};

      if (clientDataURL !== undefined) {
        try {
          entry.signatures[leg].client = saveSignatureDataURLStrict(
            clientDataURL,
            `${leg}_client`
          );
        } catch {
          return res
            .status(400)
            .json({ error: "Invalid client signature dataURL" });
        }
      }

      if (staffDataURL !== undefined && staffDataURL !== null) {
        try {
          entry.signatures[leg].staff = saveSignatureDataURLStrict(
            staffDataURL,
            `${leg}_staff`
          );
        } catch {
          return res
            .status(400)
            .json({ error: "Invalid staff signature dataURL" });
        }
      } else if (useDefaultStaff) {
        const pub = refreshDefaultStaffSignaturePublic();
        if (!pub) {
          return res.status(400).json({
            error:
              "Brak domyślnego podpisu pracownika (staff-sign.png/jpg). Nie można zastosować automatycznego podpisu.",
          });
        }
        entry.signatures[leg].staff = pub;
      }

      const t = entry.signatures.transfer;
      const r = entry.signatures.return;
      const transferDone = !!(t && t.client && t.staff);
      const returnDone = !!(r && r.client && r.staff);
      if (transferDone && returnDone) {
        entry.queue = entry.queue || {
          courierPending: false,
          pointPending: false,
        };
        entry.queue.courierPending = false;
        entry.queue.pointPending = false;
      }

      const protocolId = await dbEnsureProtocolHeader(clientId, month);
      await dbUpsertEntry({
        protocolId,
        index: idx,
        newEntry: entry,
      });

      const after = await dbGetProtocolFull(clientId, month);
      res.json({ success: true, entry: after.entries[idx] });
    } catch (e) {
      console.error("❌ Sign save error (DB):", e);
      res.status(500).json({ error: "Failed to save signatures" });
    }
  });

  app.delete("/protocols/:clientId/:month/:index/sign", async (req, res) => {
    try {
      const { clientId, month, index } = req.params;
      const { leg, who } = req.body || {};
      if (!["transfer", "return"].includes(leg)) {
        return res.status(400).json({ error: "Invalid leg" });
      }
      if (!["staff", "client"].includes(who)) {
        return res.status(400).json({ error: "Invalid who" });
      }

      const idx = Number(index);
      const protoFull = await dbGetProtocolFull(clientId, month);
      const entry = protoFull.entries[idx];
      if (!entry) {
        return res.status(404).json({ error: "Entry not found" });
      }

      const currentPub = entry?.signatures?.[leg]?.[who] || null;

      function publicToAbsolute(pub) {
        if (!pub || typeof pub !== "string") return null;
        const rel = pub.replace(/^\/+/, "");
        const abs = path.join(ROOT, rel);
        if (abs.startsWith(SIGNATURES_DIR)) return abs;
        return null;
      }

      if (currentPub) {
        const abs = publicToAbsolute(currentPub);
        if (abs && fs.existsSync(abs)) {
          if (!currentPub.includes("/_static/")) {
            try {
              fs.unlinkSync(abs);
            } catch {}
          }
        }
        entry.signatures = entry.signatures || {};
        entry.signatures[leg] = entry.signatures[leg] || {};
        delete entry.signatures[leg][who];

        if (
          entry.signatures[leg] &&
          !entry.signatures[leg].client &&
          !entry.signatures[leg].staff
        ) {
          delete entry.signatures[leg];
        }
        if (
          entry.signatures &&
          !entry.signatures.transfer &&
          !entry.signatures.return
        ) {
          delete entry.signatures;
        }
      }

      const protocolId = await dbEnsureProtocolHeader(clientId, month);
      await dbUpsertEntry({
        protocolId,
        index: idx,
        newEntry: entry,
      });

      const after = await dbGetProtocolFull(clientId, month);
      res.json({ success: true, entry: after.entries[idx] });
    } catch (e) {
      console.error("❌ Sign delete error (DB):", e);
      res.status(500).json({ error: "Failed to delete signature" });
    }
  });

  app.post("/protocols/:clientId/:month/:index/return", async (req, res) => {
    try {
      const { clientId, month, index } = req.params;
      const idx = Number(index);
      const body = req.body || {};

      const protoFull = await dbGetProtocolFull(clientId, month);
      const entry = protoFull.entries[idx];
      if (!entry) {
        return res.status(404).json({ error: "Entry not found" });
      }

      if (
        typeof body.returnDate === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(body.returnDate)
      ) {
        entry.returnDate = body.returnDate;
      }

      if (body.matchTransfer) {
        const src = Array.isArray(entry.tools) ? entry.tools : [];
        entry.returnTools = src.map((t) => ({
          name: String(t?.name || "").trim(),
          count: Number(t?.count || 0) || 0,
        }));
        entry.returnPackages = Number(
          body.returnPackages != null
            ? body.returnPackages
            : entry.packages || 0
        );
      } else if (Array.isArray(body.tools)) {
        entry.returnTools = body.tools.map((t) => ({
          name: String(t?.name || "").trim(),
          count: Number(t?.count || 0) || 0,
        }));
        if (body.returnPackages != null) {
          entry.returnPackages = Number(body.returnPackages) || 0;
        }
      } else if (body.returnPackages != null) {
        entry.returnPackages = Number(body.returnPackages) || 0;
      }

      if (
        body.returnDelivery == null ||
        ["odbior", "dowoz", "odbior+dowoz", null].includes(body.returnDelivery)
      ) {
        entry.returnDelivery =
          body.returnDelivery === undefined
            ? entry.returnDelivery
            : body.returnDelivery;
      }
      if (typeof body.returnShipping === "boolean") {
        entry.returnShipping = !!body.returnShipping;
      }

      const protocolId = await dbEnsureProtocolHeader(clientId, month);
      await dbUpsertEntry({
        protocolId,
        index: idx,
        newEntry: entry,
      });

      const after = await dbGetProtocolFull(clientId, month);
      res.json({
        success: true,
        entry: after.entries[idx],
        protocol: after,
      });
    } catch (e) {
      console.error("❌ Return save error (DB):", e);
      res.status(500).json({ error: "Failed to save return info" });
    }
  });

  app.patch("/protocols/:clientId/:month/:index", async (req, res) => {
    try {
      const { clientId, month, index } = req.params;
      const idx = Number(index);

      if (!/^\d{4}-\d{2}$/.test(month)) {
        return res.status(400).json({ error: "Invalid month format" });
      }
      if (!Number.isInteger(idx) || idx < 0) {
        return res.status(400).json({ error: "Invalid index" });
      }

      const body = req.body || {};
      const {
        date,
        comment,
        tools,
        packages,
        shipping,
        delivery,
        returnDate,
        returnTools,
        returnPackages,
        returnDelivery,
        returnShipping,
        courierPlannedDate,
      } = body;

      const currentProto = await dbGetProtocolFull(clientId, month);

      const baseExisting = currentProto.entries[idx] || {
        date: date && isISODate(date) ? date : todayLocalISO(),
        tools: [],
        packages: 0,
        shipping: false,
        delivery: null,
        comment: "",
        queue: { courierPending: false, pointPending: false },
      };

      const updated = { ...baseExisting };

      if (typeof date === "string" && isISODate(date)) updated.date = date;
      if (typeof comment === "string") updated.comment = comment;

      if (Array.isArray(tools)) {
        updated.tools = tools
          .filter((t) => t && (t.name || t.nazwa || typeof t === "string"))
          .map((t) =>
            typeof t === "string"
              ? { name: t.trim(), count: 0 }
              : {
                  name: String(t.name || t.nazwa || "").trim(),
                  count: Number(t.count || t.ilosc || 0) || 0,
                }
          );
      }

      if (packages !== undefined && packages !== null) {
        const p = Number(packages);
        if (!Number.isNaN(p) && Number.isFinite(p)) updated.packages = p;
      }
      if (typeof shipping === "boolean") updated.shipping = !!shipping;

      if (delivery === null || delivery === "") {
        updated.delivery = null;
      } else if (typeof delivery === "string") {
        const d = delivery.trim();
        if (["odbior", "dowoz", "odbior+dowoz"].includes(d)) {
          updated.delivery = d;
        }
      }

      if (typeof returnDate === "string" && isISODate(returnDate)) {
        updated.returnDate = returnDate;
      }
      if (Array.isArray(returnTools)) {
        updated.returnTools = returnTools
          .filter((t) => t && (t.name || t.nazwa || typeof t === "string"))
          .map((t) =>
            typeof t === "string"
              ? { name: t.trim(), count: 0 }
              : {
                  name: String(t.name || t.nazwa || "").trim(),
                  count: Number(t.count || t.ilosc || 0) || 0,
                }
          );
      }
      if (returnPackages !== undefined && returnPackages !== null) {
        const rp = Number(returnPackages);
        if (!Number.isNaN(rp) && Number.isFinite(rp))
          updated.returnPackages = rp;
      }
      if (returnDelivery === null || returnDelivery === "") {
        updated.returnDelivery = null;
      } else if (typeof returnDelivery === "string") {
        const rd = returnDelivery.trim();
        if (["odbior", "dowoz", "odbior+dowoz"].includes(rd)) {
          updated.returnDelivery = rd;
        }
      }
      if (typeof returnShipping === "boolean") {
        updated.returnShipping = !!returnShipping;
      }

      if (typeof courierPlannedDate !== "undefined") {
        updated.queue = updated.queue || {
          courierPending: false,
          pointPending: false,
        };
        if (isISODate(courierPlannedDate)) {
          updated.queue.courierPlannedDate = courierPlannedDate;
        } else {
          delete updated.queue.courierPlannedDate;
        }
      }

      const srcMonth = month;
      const dstMonth =
        (updated.date && ymFromISO(updated.date)) ||
        (baseExisting.date && ymFromISO(baseExisting.date)) ||
        srcMonth;

      const movingToAnotherMonth = dstMonth !== srcMonth;

      if (movingToAnotherMonth) {
        await dbDeleteEntryByIndex(clientId, srcMonth, idx);

        const newProtoId = await dbEnsureProtocolHeader(clientId, dstMonth);
        await dbUpsertEntry({
          protocolId: newProtoId,
          index: null,
          newEntry: updated,
        });

        const srcFull = await dbGetProtocolFull(clientId, srcMonth);
        const dstFull = await dbGetProtocolFull(clientId, dstMonth);

        return res.json({
          success: true,
          moved: true,
          from: {
            month: srcMonth,
            index: idx,
            totals: computeMonthlyTotals(srcFull),
          },
          to: {
            month: dstMonth,
            index: dstFull.entries.length - 1,
            totals: computeMonthlyTotals(dstFull),
          },
          entry: updated,
        });
      }

      const protocolId = await dbEnsureProtocolHeader(clientId, srcMonth);
      await dbUpsertEntry({
        protocolId,
        index: idx,
        newEntry: updated,
      });

      const after = await dbGetProtocolFull(clientId, srcMonth);

      return res.json({
        success: true,
        moved: false,
        month: srcMonth,
        index: Math.min(idx, after.entries.length - 1),
        entry: after.entries[Math.min(idx, after.entries.length - 1)],
        totals: after.totals,
      });
    } catch (e) {
      console.error("❌ Patch entry error (DB):", e);
      res.status(500).json({ error: "Failed to patch protocol entry" });
    }
  });

  app.get("/protocols/:clientId/:month/:index", async (req, res) => {
    try {
      const clientId = decodeURIComponent(req.params.clientId);
      const month = req.params.month;
      const index = Number(req.params.index);
      if (!Number.isInteger(index) || index < 0) {
        return res.status(400).json({ error: "Invalid index" });
      }
      if (!/^\d{4}-\d{2}$/.test(month)) {
        return res.status(400).json({ error: "Invalid month format" });
      }

      const protoFull = await dbGetProtocolFull(clientId, month);
      const entry = protoFull.entries[index] || null;

      return res.json({
        id: clientId,
        month,
        index,
        entry,
        totals: protoFull.totals,
      });
    } catch (e) {
      console.error("❌ Error reading single protocol entry (DB):", e);
      res.status(500).json({ error: "Failed to load protocol entry" });
    }
  });

  app.post("/protocols/:clientId/:month/return/bulk", async (req, res) => {
    try {
      const { clientId, month } = req.params;
      const { indices, returnDate } = req.body || {};
      if (!Array.isArray(indices) || !indices.length) {
        return res
          .status(400)
          .json({ error: "indices must be a non-empty array" });
      }
      if (
        typeof returnDate !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(returnDate)
      ) {
        return res.status(400).json({ error: "Invalid returnDate" });
      }

      const protoFull = await dbGetProtocolFull(clientId, month);

      for (const i of indices) {
        const idx = Number(i);
        if (!Number.isInteger(idx)) continue;
        if (!protoFull.entries[idx]) continue;
        protoFull.entries[idx].returnDate = returnDate;

        const protocolId = await dbEnsureProtocolHeader(clientId, month);
        await dbUpsertEntry({
          protocolId,
          index: idx,
          newEntry: protoFull.entries[idx],
        });
      }

      const after = await dbGetProtocolFull(clientId, month);
      res.json({ success: true, protocol: after });
    } catch (e) {
      console.error("❌ Bulk returnDate update error (DB):", e);
      res.status(500).json({ error: "Failed to bulk update returnDate" });
    }
  });

  app.post("/protocols/:clientId/:month/summarize", async (req, res) => {
    try {
      const { clientId, month } = req.params;
      const { summarized } = req.body || {};
      if (!/^\d{4}-\d{2}$/.test(month)) {
        return res.status(400).json({ error: "Invalid month format" });
      }

      await dbSetSummarized(clientId, month, !!summarized);
      const after = await dbGetProtocolFull(clientId, month);

      res.json({ success: true, protocol: after });
    } catch (e) {
      console.error("❌ summarize protocol error (DB):", e);
      res.status(500).json({ error: "Failed to summarize/unsummarize" });
    }
  });

  app.get("/sign-queue-db", authGuard, async (req, res) => {
    try {
      const type = String(req.query.type || "").toLowerCase();
      if (!["courier", "point"].includes(type)) {
        return res
          .status(400)
          .json({ error: "type must be 'courier' or 'point'" });
      }

      const monthFilter =
        typeof req.query.month === "string" &&
        /^\d{4}-\d{2}$/.test(req.query.month)
          ? req.query.month
          : null;
      const dayFilter =
        typeof req.query.date === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
          ? req.query.date
          : null;

      let items = [];

      const listLite = await dbListProtocolsWithEntriesLite();
      const clientsIdx = await dbGetAllClientsIndex();

      for (const p of listLite) {
        if (monthFilter && p.month !== monthFilter) continue;
        const full = await dbGetProtocolFull(p.id, p.month);
        full.entries.forEach((e, i) => {
          const q = e.queue || {};
          const pending =
            type === "courier" ? !!q.courierPending : !!q.pointPending;
          if (!pending) return;

          if (type === "courier") {
            const planned =
              typeof q.courierPlannedDate === "string" &&
              /^\d{4}-\d{2}-\d{2}$/.test(q.courierPlannedDate)
                ? q.courierPlannedDate
                : null;
            if (dayFilter && planned && planned > dayFilter) return;
          }

          items.push({
            clientId: full.id,
            clientName: clientsIdx[full.id]?.name || full.id,
            month: full.month,
            index: i,
            date: e.date || null,
            returnDate: e.returnDate || null,
            tools: Array.isArray(e.tools) ? e.tools : [],
            packages: Number(e.packages || 0) || 0,
            delivery: e.delivery || null,
            shipping: !!e.shipping,
            comment: e.comment || "",
            signatures: e.signatures || {},
            queue: {
              ...(e.queue || {}),
              courierPlannedDate: (e.queue || {}).courierPlannedDate || null,
            },
          });
        });
      }

      return res.json({ items });
    } catch (e) {
      console.error("❌ /sign-queue error:", e);
      res.status(500).json({ error: "Failed to load sign queue" });
    }
  });

  app.get("/__db/check-protocols", authGuard, async (_req, res) => {
    try {
      const pcRows = await sql(`SELECT COUNT(*) AS c FROM protocols`);
      const ecRows = await sql(`SELECT COUNT(*) AS c FROM protocol_entries`);
      const pc = pcRows[0];
      const ec = ecRows[0];

      const protoHeads = await sql(`
        SELECT id AS protocolId, clientId, month, summarized, createdAt, updatedAt
        FROM protocols
        ORDER BY month DESC, clientId ASC
        LIMIT 20
      `);

      const latestEntries = await sql(`
        SELECT id, protocol_id AS protocolId, date, packages, delivery, shipping
        FROM protocol_entries
        ORDER BY id DESC
        LIMIT 20
      `);

      const joinAgg = await sql(`
        SELECT p.id AS protocolId, p.clientId, p.month, COUNT(e.id) AS entries
        FROM protocols p
        LEFT JOIN protocol_entries e ON e.protocol_id = p.id
        GROUP BY p.id, p.clientId, p.month
        ORDER BY p.month DESC, p.clientId ASC
        LIMIT 100
      `);

      res.json({
        counts: { protocols: pc.c, entries: ec.c },
        heads: protoHeads,
        latestEntries,
        byProtocol: joinAgg,
        defaultStaffSig: getDefaultStaffSignaturePublic(),
      });
    } catch (e) {
      console.error("DEBUG /__db/check-protocols", e);
      res.status(500).json({ error: String(e.message) });
    }
  });

  app.get(
    "/__db/protocol-full/:clientId/:month",
    authGuard,
    async (req, res) => {
      try {
        const clientId = decodeURIComponent(req.params.clientId);
        const month = req.params.month;
        const data = await dbGetProtocolFull(clientId, month);
        res.json(data);
      } catch (e) {
        console.error("DEBUG /__db/protocol-full", e);
        res.status(500).json({ error: String(e.message) });
      }
    }
  );
};
