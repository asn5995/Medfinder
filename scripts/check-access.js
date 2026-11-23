// Development-only check. The public anon key must not insert or delete.
// MEDFINDER_DATABASE=production refuses to run. No key is printed.

var ROW = "security-probe-" + Date.now().toString(36);

function headers(key) {
  return {
    apikey: key,
    Authorization: "Bearer " + key,
    "Content-Type": "application/json",
    Prefer: "return=representation"
  };
}

function request(url, key, method, body) {
  return fetch(url, {
    method: method,
    headers: headers(key),
    body: body == null ? undefined : JSON.stringify(body)
  }).then(function (response) {
    return response.text().then(function (text) {
      return { status: response.status, text: text };
    });
  });
}

function rejected(result) {
  return result.status === 401 || result.status === 403 || result.status === 404;
}

async function main() {
  if (process.env.MEDFINDER_DATABASE === "production") {
    console.error("Refusing to run the access check against production.");
    return 1;
  }
  var base = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  var anon = process.env.SUPABASE_ANON_KEY || "";
  var service = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!base || !anon) {
    console.error("Need SUPABASE_URL and SUPABASE_ANON_KEY for the development project.");
    return 2;
  }
  var table = base + "/rest/v1/prescriptions?id=eq." + encodeURIComponent(ROW);
  var collection = base + "/rest/v1/prescriptions";
  var inserted = await request(collection, anon, "POST", {
    id: ROW,
    patient_name: "security probe",
    source_file_name: "",
    saved_at: ""
  });
  if (!rejected(inserted) && inserted.status < 300) {
    console.error("Anon insert was accepted. Status " + inserted.status + ".");
    if (service) await request(table, service, "DELETE");
    return 1;
  }
  console.log("Anon insert rejected with status " + inserted.status + ".");

  if (!service) {
    console.log("No service-role key, so the delete check was not run against a real row.");
    return 0;
  }
  var seeded = await request(collection, service, "POST", {
    id: ROW,
    patient_name: "security probe",
    source_file_name: "",
    saved_at: ""
  });
  if (seeded.status >= 300) {
    console.error("Service role could not insert the probe row. Status " + seeded.status + ".");
    return 1;
  }
  var removed = await request(table, anon, "DELETE");
  var after = await request(table, service, "GET");
  var stillThere = after.status < 300 && after.text.indexOf(ROW) !== -1;
  await request(table, service, "DELETE");
  if (!stillThere) {
    console.error("Anon delete changed a row. Delete status " + removed.status + ".");
    return 1;
  }
  console.log("Anon delete left the probe row in place. Delete status " + removed.status + ".");
  return 0;
}

if (require.main === module) {
  main().then(function (code) {
    process.exit(code);
  }).catch(function (error) {
    console.error(error && error.message ? error.message : "access check failed");
    process.exit(1);
  });
}

module.exports = { rejected: rejected };
