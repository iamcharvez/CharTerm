import { defaultPreferences, loadPreferences, savePreferences } from "./preferences";

describe("preferences", () => {
  beforeEach(() => localStorage.clear());

  it("loads safe defaults and persists updates", () => {
    expect(loadPreferences()).toEqual(defaultPreferences);
    const updated = { ...defaultPreferences, fontSize: 18, reducedMotion: true };
    savePreferences(updated);
    expect(loadPreferences()).toEqual(updated);
  });

  it("recovers from invalid stored data", () => {
    localStorage.setItem("charterm-preferences", "not-json");
    expect(loadPreferences()).toEqual(defaultPreferences);
  });
});
