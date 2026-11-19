package me.kirancodes.zoomerlip;

import android.content.Intent;
import android.net.Uri;
import android.webkit.MimeTypeMap;
import android.webkit.WebChromeClient;
import java.util.LinkedHashSet;
import java.util.Locale;

final class FileChooserPolicy {
    static final int MAX_FILES = 20;
    static String[] mimeTypes(String[] accepts) {
        LinkedHashSet<String> result = new LinkedHashSet<>();
        for (String accept : accepts) {
            for (String part : accept.split(",")) {
                String type = part.trim().toLowerCase(Locale.ROOT);
                if (type.isEmpty() || type.equals("*/*")) return new String[]{"*/*"};
                if (type.startsWith(".")) {
                    type = type.equals(".json") ? "application/json" : MimeTypeMap.getSingleton().getMimeTypeFromExtension(type.substring(1));
                    if (type == null) return new String[]{"*/*"};
                }
                if (type.matches("[a-z0-9!#$&^_.+-]+/(\\*|[a-z0-9!#$&^_.+-]+)")) result.add(type);
            }
        }
        return result.isEmpty() ? new String[]{"*/*"} : result.stream().limit(32).toArray(String[]::new);
    }
    static Intent intent(WebChromeClient.FileChooserParams params) {
        String[] types = mimeTypes(params.getAcceptTypes());
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
            .setType(types.length == 1 ? types[0] : "*/*")
            .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE);
        if (types.length > 1) intent.putExtra(Intent.EXTRA_MIME_TYPES, types);
        return intent;
    }
    static Uri[] selected(Intent data, boolean multiple) {
        if (data == null) return null;
        LinkedHashSet<Uri> result = new LinkedHashSet<>();
        if (data.getData() != null) result.add(data.getData());
        if (multiple && data.getClipData() != null) {
            if (data.getClipData().getItemCount() > MAX_FILES) return null;
            for (int i = 0; i < data.getClipData().getItemCount(); i++) result.add(data.getClipData().getItemAt(i).getUri());
        }
        if (result.isEmpty() || result.size() > MAX_FILES || result.stream().anyMatch(uri -> uri == null || !"content".equals(uri.getScheme()))) return null;
        return result.toArray(new Uri[0]);
    }
}
