// Speaker notes from files: PowerPoint (.pptx) or plain text with --- between slides.

let jszip;
function loadJSZip() {
  jszip ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = new URL("./vendor/jszip.min.js?v=4346a7f8a7", import.meta.url).href;
    s.onload = () => resolve(window.JSZip);
    s.onerror = () => reject(new Error("Couldn’t load the .pptx reader"));
    document.head.append(s);
  });
  return jszip;
}

export const isNotesFile = (file) => /\.(pptx|txt|md)$/i.test(file.name);

export async function notesFromFile(file) {
  if (/\.pptx$/i.test(file.name)) return pptxNotes(file);
  return (await file.text()).split(/^\s*-{3,}\s*$/m).map((s) => s.trim());
}

const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const xml = (s) => new DOMParser().parseFromString(s, "application/xml");
const all = (node, tag) => [...node.getElementsByTagNameNS("*", tag)];

/** Resolves a relationship target like "../notesSlides/notesSlide1.xml" against the part that owns it. */
function resolvePart(fromPart, target) {
  if (target.startsWith("/")) return target.slice(1);
  const parts = fromPart.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

function relsOf(zip, part) {
  const path = part.replace(/([^/]+)$/, "_rels/$1.rels");
  return zip.file(path)?.async("string").then((s) => all(xml(s), "Relationship")) ?? Promise.resolve([]);
}

async function pptxNotes(file) {
  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(file);
  const presPart = "ppt/presentation.xml";
  const pres = xml(await zip.file(presPart).async("string"));
  const rels = Object.fromEntries((await relsOf(zip, presPart)).map((r) => [r.getAttribute("Id"), r.getAttribute("Target")]));
  const notes = [];

  for (const sldId of all(pres, "sldId")) {
    const slidePart = resolvePart(presPart, rels[sldId.getAttributeNS(REL_NS, "id")]);
    const slide = xml(await zip.file(slidePart).async("string"));
    // Hidden slides are left out of PDF exports by default, so skip them to keep pages aligned.
    if (slide.documentElement.getAttribute("show") === "0") continue;
    const notesRel = (await relsOf(zip, slidePart)).find((r) => /\/notesSlide$/.test(r.getAttribute("Type")));
    let text = "";
    if (notesRel) {
      const doc = xml(await zip.file(resolvePart(slidePart, notesRel.getAttribute("Target"))).async("string"));
      text = all(doc, "sp")
        .filter((sp) => all(sp, "ph").some((ph) => ph.getAttribute("type") === "body"))
        .map((sp) => all(sp, "p").map((p) => all(p, "t").map((t) => t.textContent).join("")).join("\n"))
        .join("\n")
        .trim();
    }
    notes.push(text);
  }
  return notes;
}
