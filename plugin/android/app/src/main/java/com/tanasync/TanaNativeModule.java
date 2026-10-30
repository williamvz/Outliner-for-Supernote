package com.tanasync;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;

/**
 * Small text-file store. PluginHost ships no AsyncStorage, so settings, the
 * outbox and the spike log are kept as files in the plugin's private
 * directory (the one path plugins may write without a permission).
 * Files are overwritten in place: the firmware does not let plugins delete
 * files, and may treat a rename-over as a delete.
 */
public class TanaNativeModule extends ReactContextBaseJavaModule {

    public TanaNativeModule(ReactApplicationContext context) {
        super(context);
    }

    @Override
    public String getName() {
        return "TanaNative";
    }

    /** Resolves the file's text, or null when it does not exist. */
    @ReactMethod
    public void readFile(String path, Promise promise) {
        try {
            File file = new File(path);
            if (!file.exists()) {
                promise.resolve(null);
                return;
            }
            byte[] bytes = new byte[(int) file.length()];
            try (FileInputStream in = new FileInputStream(file)) {
                int read = 0;
                while (read < bytes.length) {
                    int n = in.read(bytes, read, bytes.length - read);
                    if (n < 0) break;
                    read += n;
                }
            }
            promise.resolve(new String(bytes, StandardCharsets.UTF_8));
        } catch (Exception e) {
            promise.reject("read_failed", e);
        }
    }

    @ReactMethod
    public void writeFile(String path, String content, Promise promise) {
        write(path, content, false, promise);
    }

    @ReactMethod
    public void appendFile(String path, String content, Promise promise) {
        write(path, content, true, promise);
    }

    private void write(String path, String content, boolean append, Promise promise) {
        try {
            File file = new File(path);
            File parent = file.getParentFile();
            if (parent != null && !parent.exists()) {
                parent.mkdirs();
            }
            try (Writer out = new OutputStreamWriter(new FileOutputStream(file, append), StandardCharsets.UTF_8)) {
                out.write(content);
                out.flush();
            }
            promise.resolve(true);
        } catch (Exception e) {
            promise.reject("write_failed", e);
        }
    }
}
