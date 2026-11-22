import { createTheme } from "@mui/material";

const display = '"Bricolage Grotesque", "Segoe UI", system-ui, sans-serif';
const body = '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif';

export const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#14213d" },
    secondary: { main: "#f7e35a", contrastText: "#14213d" },
    success: { main: "#1f8a70" },
    warning: { main: "#c9861a" },
    error: { main: "#b3402f" },
    background: { default: "#eef1f5", paper: "#ffffff" },
    text: { primary: "#14213d", secondary: "#5a6478" },
    divider: "#d5dbe5",
  },
  shape: { borderRadius: 6 },
  typography: {
    fontFamily: body,
    h1: { fontFamily: display, fontWeight: 700, letterSpacing: "-0.02em" },
    h2: { fontFamily: display, fontWeight: 700, letterSpacing: "-0.015em" },
    h3: { fontFamily: display, fontWeight: 700, letterSpacing: "-0.01em" },
    h4: { fontFamily: display, fontWeight: 700 },
    h5: { fontFamily: display, fontWeight: 700 },
    h6: { fontFamily: display, fontWeight: 700 },
    button: { textTransform: "none", fontWeight: 600 },
  },
  components: {
    MuiButton: { defaultProps: { disableElevation: true } },
    MuiPaper: { defaultProps: { elevation: 0 } },
    MuiChip: { styleOverrides: { root: { fontWeight: 500 } } },
  },
});
