export default {
  content: ["./src/content/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        talkable: {
          blue: "#4F7CFF",
          green: "#22C55E",
          night: "#0F1117",
          card: "#171923"
        }
      }
    }
  },
  corePlugins: {
    preflight: false
  }
};
