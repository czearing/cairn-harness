import type { ModelCatalogState } from "./types";

export function modelCatalogCopy(catalog: Extract<ModelCatalogState, { status: "error" }>) {
  if (catalog.code === "copilot-not-found") {
    return {
      title: "Models couldn’t be checked",
      body: "The dashboard couldn’t start the Copilot CLI. Install copilot or set HARNESS_COPILOT_BIN, then retry.",
    };
  }
  if (catalog.code === "timeout") {
    return { title: "Model check timed out", body: "The Copilot CLI did not return the model catalog in time. Existing settings are unchanged." };
  }
  if (catalog.code === "empty") {
    return { title: "No models were returned", body: "The Copilot CLI returned an empty model catalog. Existing settings are unchanged." };
  }
  return { title: "Models couldn’t be checked", body: "The model catalog could not be loaded. Existing settings are unchanged." };
}
