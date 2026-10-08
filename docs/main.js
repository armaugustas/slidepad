import { isPhone } from "./common.js";

const params = new URLSearchParams(location.search);
const as = params.get("as");
const asRemote = params.has("join") || as === "remote" || (as !== "screen" && isPhone());

const { start } = asRemote ? await import("./remote.js") : await import("./screen.js");
start(document.getElementById("app"), params);
