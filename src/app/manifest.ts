import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Scaid — design in 3D by describing it",
    short_name: "Scaid",
    description:
      "Describe what you want to build and watch it become a real 3D model you can spin, study and print.",
    start_url: "/studio",
    display: "standalone",
    // Matches the app's own background, so the splash screen doesn't flash white.
    background_color: "#0b0e14",
    theme_color: "#0b0e14",
    orientation: "any",
    categories: ["productivity", "graphics", "education"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Padded so Android's shape mask can't crop the cube.
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
