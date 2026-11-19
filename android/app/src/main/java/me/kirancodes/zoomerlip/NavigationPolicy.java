package me.kirancodes.zoomerlip;

import java.net.URI;

final class NavigationPolicy {
    static final String ORIGIN = "https://appassets.androidplatform.net";
    static final String START = ORIGIN + "/index.html";
    static boolean localDocument(String value) {
        try {
            URI u = new URI(value);
            return "https".equals(u.getScheme()) && "appassets.androidplatform.net".equals(u.getHost())
                && u.getPort() == -1 && u.getUserInfo() == null
                && ("/".equals(u.getPath()) || "/index.html".equals(u.getPath()));
        } catch (Exception ignored) { return false; }
    }
    static boolean external(String value) {
        try {
            URI u = new URI(value);
            if ("mailto".equals(u.getScheme())) return !u.getSchemeSpecificPart().trim().isEmpty();
            return ("https".equals(u.getScheme()) || "http".equals(u.getScheme()))
                && u.getHost() != null && u.getUserInfo() == null
                && !"appassets.androidplatform.net".equals(u.getHost());
        } catch (Exception ignored) { return false; }
    }
}
