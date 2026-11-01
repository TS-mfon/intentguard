// Runs the production static frontend against isolated HTTPS/API/wallet controls.
// The report explicitly distinguishes these UX checks from live chain acceptance.
await import("./production-browser");
export {};
