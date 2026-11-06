package com.kythie.sullyos;

import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

/**
 * App 壳自己的小工具（个人二改）：
 *  - getBuild：这个安装包是哪次打包的（打包时写进资源里的时间戳）
 *  - downloadAndInstall：在 App 里下载新安装包，下完直接弹系统安装界面（签名一样，覆盖安装不丢数据）
 */
@CapacitorPlugin(name = "AppShell")
public class AppShellPlugin extends Plugin {

    @PluginMethod
    public void getBuild(PluginCall call) {
        JSObject r = new JSObject();
        int id = getContext().getResources().getIdentifier("noah_build_stamp", "string", getContext().getPackageName());
        r.put("stamp", id != 0 ? getContext().getString(id) : "");
        r.put("canInstall", Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getContext().getPackageManager().canRequestPackageInstalls());
        call.resolve(r);
    }

    @PluginMethod
    public void openInstallPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        }
        call.resolve();
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        final String url = call.getString("url");
        if (url == null || url.isEmpty()) { call.reject("没有下载地址"); return; }
        final Context ctx = getContext();
        final File dir = ctx.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (dir == null) { call.reject("找不到下载目录"); return; }
        final File out = new File(dir, "SullyOS-update.apk");
        if (out.exists()) out.delete();

        final DownloadManager dm = (DownloadManager) ctx.getSystemService(Context.DOWNLOAD_SERVICE);
        DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
        req.setTitle("诺亚手机 · 新版本");
        req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE);
        req.setDestinationUri(Uri.fromFile(out));
        req.setMimeType("application/vnd.android.package-archive");
        final long id = dm.enqueue(req);
        call.resolve();

        new Thread(() -> {
            while (true) {
                try { Thread.sleep(700); } catch (InterruptedException e) { return; }
                Cursor c = dm.query(new DownloadManager.Query().setFilterById(id));
                if (c == null || !c.moveToFirst()) { if (c != null) c.close(); emit("failed", 0, "下载被取消了"); return; }
                int status = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                long done = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
                long total = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
                c.close();
                if (status == DownloadManager.STATUS_SUCCESSFUL) { emit("done", 1, ""); install(out); return; }
                if (status == DownloadManager.STATUS_FAILED) { emit("failed", 0, "下载失败（网络 / 梯子？）"); return; }
                emit("progress", total > 0 ? (double) done / total : 0, "");
            }
        }).start();
    }

    private void emit(String state, double progress, String message) {
        JSObject o = new JSObject();
        o.put("state", state); o.put("progress", progress); o.put("message", message);
        notifyListeners("update", o);
    }

    private void install(File apk) {
        Context ctx = getContext();
        Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", apk);
        Intent i = new Intent(Intent.ACTION_VIEW);
        i.setDataAndType(uri, "application/vnd.android.package-archive");
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        ctx.startActivity(i);
    }
}
