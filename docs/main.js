import { isPhone } from "./common.js?v=4346a7f8a7";

const params = new URLSearchParams(location.search);
const as = params.get("as");
const asRemote = params.has("join") || as === "remote" || (as !== "screen" && isPhone());

const { start } = asRemote ? await import("./remote.js?v=4346a7f8a7") : await import("./screen.js?v=4346a7f8a7");
start(document.getElementById("app"), params);
