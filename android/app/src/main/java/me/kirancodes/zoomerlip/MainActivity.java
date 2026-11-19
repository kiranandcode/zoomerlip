package me.kirancodes.zoomerlip;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Message;
import android.webkit.*;
import android.widget.FrameLayout;
import android.widget.Toast;
import android.view.WindowInsets;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Arrays;

public final class MainActivity extends Activity {
    private static final int PICK_THEME = 1, SAVE_THEME = 2;
    private WebView web;
    private ValueCallback<Uri[]> fileSelection;
    private String pendingExport;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        FrameLayout root = new FrameLayout(this);
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((v, insets) -> {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                android.graphics.Insets keyboard = insets.getInsets(WindowInsets.Type.ime());
                v.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, keyboard.bottom));
                return WindowInsets.CONSUMED;
            });
        }
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        // The document picker grants access only to the file chosen by the user.
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSafeBrowsingEnabled(true);
        WebView.setWebContentsDebuggingEnabled(false);
        CookieManager.getInstance().setAcceptCookie(false);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        WebViewAssetLoader assets = new WebViewAssetLoader.Builder()
            .addPathHandler("/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (!"appassets.androidplatform.net".equals(request.getUrl().getHost())) return null;
                WebResourceResponse response = assets.shouldInterceptRequest(request.getUrl());
                return response != null ? response : new WebResourceResponse("text/plain", "UTF-8", 404, "Not found", null, new ByteArrayInputStream(new byte[0]));
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return true;
                String url = request.getUrl().toString();
                if (NavigationPolicy.localDocument(url)) return false;
                if (request.hasGesture()) openExternal(url);
                return true;
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) { handler.cancel(); }
            @Override public void onReceivedHttpAuthRequest(WebView view, HttpAuthHandler handler, String host, String realm) { handler.cancel(); }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) { request.deny(); }
            @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) { callback.invoke(origin, false, false); }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (!NavigationPolicy.localDocument(web.getUrl())) return false;
                if (fileSelection != null) fileSelection.onReceiveValue(null);
                fileSelection = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*")
                    .putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/json", "text/plain", "application/octet-stream"});
                try { startActivityForResult(intent, PICK_THEME); return true; }
                catch (ActivityNotFoundException e) { fileSelection = null; callback.onReceiveValue(null); return true; }
            }
            @Override public boolean onCreateWindow(WebView view, boolean dialog, boolean gesture, Message message) {
                if (!gesture || !NavigationPolicy.localDocument(view.getUrl())) return false;
                // Never load remote pages in the WebView that holds Zulip credentials.
                WebView popup = new WebView(MainActivity.this);
                popup.getSettings().setJavaScriptEnabled(false);
                popup.getSettings().setAllowFileAccess(false);
                popup.getSettings().setAllowContentAccess(false);
                popup.setWebViewClient(new WebViewClient() {
                    @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                        String url = r.getUrl().toString();
                        if ("about:blank".equals(url)) return false;
                        if (r.isForMainFrame()) openExternal(url);
                        v.post(v::destroy);
                        return true;
                    }
                });
                popup.setWebChromeClient(new WebChromeClient() {
                    @Override public void onCloseWindow(WebView window) { window.destroy(); }
                });
                ((WebView.WebViewTransport) message.obj).setWebView(popup);
                message.sendToTarget();
                return true;
            }
        });
        // A write-only theme export bridge, restricted to this bundled document's origin.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "ZoomerlipThemeExport", Collections.singleton(NavigationPolicy.ORIGIN),
                (view, message, origin, mainFrame, reply) -> {
                    if (message.getType() != androidx.webkit.WebMessageCompat.TYPE_STRING || !mainFrame || !NavigationPolicy.ORIGIN.equals(origin.toString()) || !NavigationPolicy.localDocument(view.getUrl())) return;
                    exportTheme(message.getData());
                });
        }
        web.loadUrl(NavigationPolicy.START);
    }

    private void openExternal(String value) {
        if (!NavigationPolicy.external(value)) return;
        try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(value)).addCategory(Intent.CATEGORY_BROWSABLE)); }
        catch (ActivityNotFoundException e) { Toast.makeText(this, "No app can open this link.", Toast.LENGTH_SHORT).show(); }
    }
    private void exportTheme(String value) {
        if (pendingExport != null || value == null || value.length() > 16384) return;
        try {
            JSONObject theme = new JSONObject(value);
            if (!Integer.valueOf(1).equals(theme.get("version")) || !Arrays.asList("dark", "light").contains(theme.getString("base"))) return;
            String name = theme.getString("name");
            if (name.trim().isEmpty() || name.length() > 48) return;
            JSONObject colours = theme.getJSONObject("colours"), cleanColours = new JSONObject();
            for (String key : new String[]{"rail", "sidebar", "surface", "raised", "field", "text", "secondary", "muted", "accent"}) {
                String colour = colours.getString(key);
                if (!colour.matches("#[0-9a-fA-F]{6}")) return;
                cleanColours.put(key, colour);
            }
            // Export only theme fields; discard any unrelated values in a message.
            pendingExport = new JSONObject().put("version", 1).put("name", name).put("base", theme.getString("base")).put("colours", cleanColours).toString(2);
            String filename = name.toLowerCase(java.util.Locale.ROOT).replaceAll("[^a-z0-9]+", "-").replaceAll("^-|-$", "");
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/json")
                .putExtra(Intent.EXTRA_TITLE, (filename.isEmpty() ? "zoomerlip-theme" : filename) + ".json");
            startActivityForResult(intent, SAVE_THEME);
        } catch (Exception e) { pendingExport = null; Toast.makeText(this, "Could not export the theme.", Toast.LENGTH_SHORT).show(); }
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        Uri uri = result == RESULT_OK && data != null ? data.getData() : null;
        if (uri != null && !"content".equals(uri.getScheme())) uri = null;
        if (request == PICK_THEME && fileSelection != null) {
            fileSelection.onReceiveValue(uri == null ? null : new Uri[]{uri}); fileSelection = null;
        } else if (request == SAVE_THEME) {
            String value = pendingExport; pendingExport = null;
            if (uri != null && value != null) {
                try (OutputStream out = getContentResolver().openOutputStream(uri, "wt")) {
                    if (out == null) throw new java.io.IOException("No output stream");
                    out.write(value.getBytes(StandardCharsets.UTF_8));
                } catch (Exception e) { Toast.makeText(this, "Could not save the theme.", Toast.LENGTH_SHORT).show(); }
            }
        }
    }
    @Override public void onBackPressed() {
        web.evaluateJavascript("(() => { const d=document.querySelector('dialog[open]'); if(d){d.dispatchEvent(new Event('cancel',{cancelable:true}));return true;} const m=document.querySelector('[role=menu]'); if(m){m.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return true;} const n=document.querySelector('.sidebar.mobile-open [aria-label=\"Close channels\"]'); if(n && n.getClientRects().length){n.click();return true;} const p=document.querySelector('.profile-back'); if(p){p.click();return true;} if(document.querySelector('.composer')){window.dispatchEvent(new Event('zoomerlip-home'));return true;} return false; })()", result -> {
            if (!"true".equals(result)) { if (web.canGoBack()) web.goBack(); else super.onBackPressed(); }
        });
    }
    @Override protected void onPause() { web.onPause(); super.onPause(); }
    @Override protected void onResume() { super.onResume(); if (web != null) web.onResume(); }
    @Override protected void onDestroy() {
        if (fileSelection != null) fileSelection.onReceiveValue(null);
        web.destroy(); super.onDestroy();
    }
}
