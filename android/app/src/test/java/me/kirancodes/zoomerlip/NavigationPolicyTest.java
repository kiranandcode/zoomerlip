package me.kirancodes.zoomerlip;
import org.junit.Test;
import static org.junit.Assert.*;
public class NavigationPolicyTest {
    @Test public void onlyBundledDocumentStaysInCredentialWebView() {
        assertTrue(NavigationPolicy.localDocument(NavigationPolicy.START));
        assertTrue(NavigationPolicy.localDocument(NavigationPolicy.START + "#topic"));
        for (String u : new String[]{"https://evil.test/index.html", "https://appassets.androidplatform.net.evil.test/index.html", "https://evil@appassets.androidplatform.net/index.html", "https://appassets.androidplatform.net:444/index.html", "http://appassets.androidplatform.net/index.html", "file:///data/data/me.kirancodes.zoomerlip/file", "content://private", "javascript:alert(1)", NavigationPolicy.ORIGIN + "/other.html"}) assertFalse(u, NavigationPolicy.localDocument(u));
    }
    @Test public void externalLinksCannotLaunchIntentsOrExposeLocalData() {
        assertTrue(NavigationPolicy.external("https://zulip.com/help"));
        assertTrue(NavigationPolicy.external("mailto:test@example.com"));
        for (String u : new String[]{"intent://evil#Intent;end", "javascript:alert(1)", "file:///tmp/key", "content://private", "data:text/html,hello", "https://user:password@example.com", NavigationPolicy.START, "https://"}) assertFalse(u, NavigationPolicy.external(u));
    }
}
