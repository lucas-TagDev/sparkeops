export type Branding = {
  name: string;
  primaryColor: string;
  logo: string | null;
  favicon: string | null;
  revision: string;
};
export const defaultBranding: Branding = {
  name: "FoxOps",
  primaryColor: "#79e2af",
  logo: null,
  favicon: null,
  revision: "default",
};
export const brandingTextColor = (color: string) => {
  const values = color
    .slice(1)
    .match(/../g)!
    .map((s) => parseInt(s, 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const luminance =
    values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
  return luminance > 0.179 ? "#09131c" : "#ffffff";
};
