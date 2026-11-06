package com.kythie.sullyos;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * 系统级悬浮歌词（个人二改）：App 切到后台、在别的 App 里也能看到歌词。
 * 网页把整首歌的时间轴一次性给过来（setLyrics），之后只在播放 / 暂停 / 拖进度 / 换歌时同步一下位置（sync），
 * 原生自己按时钟推进到哪一句——网页在后台被限速也不影响。
 * 回到 App 里自动收起（App 里有自己的桌面歌词）。拖动换位置；长按收起到下次打开。
 */
@CapacitorPlugin(name = "FloatingLyric")
public class FloatingLyricPlugin extends Plugin {
    private static class Line { long t; String text; String tr; }

    private final Handler main = new Handler(Looper.getMainLooper());
    private final List<Line> lines = new ArrayList<>();
    private String title = "";
    private long basePosMs = 0;
    private long baseClock = 0;
    private boolean playing = false;
    private boolean enabled = false;
    private boolean inBackground = false;
    private boolean dismissed = false;
    private float fontSp = 17f;

    private WindowManager wm;
    private LinearLayout box;
    private TextView mainTv, subTv;
    private WindowManager.LayoutParams lp;
    private int lastIdx = -2;

    private final Runnable tick = new Runnable() {
        @Override public void run() {
            render();
            if (box != null) main.postDelayed(this, 250);
        }
    };

    private boolean canDraw() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(getContext());
    }

    @PluginMethod
    public void checkPermission(PluginCall call) {
        JSObject r = new JSObject(); r.put("granted", canDraw()); call.resolve(r);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (!canDraw()) {
            Intent i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        }
        JSObject r = new JSObject(); r.put("granted", canDraw()); call.resolve(r);
    }

    @PluginMethod
    public void setEnabled(PluginCall call) {
        enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        Double fs = call.getDouble("fontSize");
        if (fs != null && fs > 8 && fs < 40) fontSp = fs.floatValue();
        main.post(this::refreshVisibility);
        call.resolve();
    }

    @PluginMethod
    public void setLyrics(PluginCall call) {
        final List<Line> next = new ArrayList<>();
        JSArray arr = call.getArray("lines");
        try {
            if (arr != null) for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                Line l = new Line();
                l.t = (long) (o.optDouble("t", 0) * 1000);
                l.text = o.optString("text", "");
                l.tr = o.optString("tr", "");
                next.add(l);
            }
        } catch (Exception ignored) { }
        final String t = call.getString("title", "");
        main.post(() -> { lines.clear(); lines.addAll(next); title = t; lastIdx = -2; dismissed = false; render(); });
        call.resolve();
    }

    @PluginMethod
    public void sync(PluginCall call) {
        final double pos = call.getDouble("position", 0.0);
        final boolean p = Boolean.TRUE.equals(call.getBoolean("playing", false));
        main.post(() -> { basePosMs = (long) (pos * 1000); baseClock = SystemClock.elapsedRealtime(); playing = p; refreshVisibility(); render(); });
        call.resolve();
    }

    @Override
    protected void handleOnPause() { inBackground = true; main.post(this::refreshVisibility); }

    @Override
    protected void handleOnResume() { inBackground = false; main.post(this::refreshVisibility); }

    @Override
    protected void handleOnDestroy() { main.post(this::removeBox); }

    private void refreshVisibility() {
        boolean want = enabled && inBackground && !dismissed && canDraw() && (playing || !lines.isEmpty() || !title.isEmpty());
        if (want && box == null) addBox();
        else if (!want && box != null) removeBox();
    }

    private long posNow() {
        return playing ? basePosMs + (SystemClock.elapsedRealtime() - baseClock) : basePosMs;
    }

    private void render() {
        if (box == null) return;
        int idx = -1;
        long p = posNow();
        for (int i = 0; i < lines.size(); i++) { if (lines.get(i).t <= p + 150) idx = i; else break; }
        if (idx == lastIdx && idx >= 0) return;
        lastIdx = idx;
        if (idx >= 0 && !lines.get(idx).text.isEmpty()) {
            mainTv.setText(lines.get(idx).text);
            String tr = lines.get(idx).tr;
            subTv.setText(tr == null ? "" : tr);
            subTv.setVisibility(tr == null || tr.isEmpty() ? View.GONE : View.VISIBLE);
        } else {
            mainTv.setText(title.isEmpty() ? "♪" : title);
            subTv.setVisibility(View.GONE);
        }
    }

    private int dp(float v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getContext().getResources().getDisplayMetrics());
    }

    private void addBox() {
        Context ctx = getContext().getApplicationContext();
        wm = (WindowManager) ctx.getSystemService(Context.WINDOW_SERVICE);
        box = new LinearLayout(ctx);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER_HORIZONTAL);
        box.setPadding(dp(14), dp(6), dp(14), dp(7));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.argb(110, 15, 18, 28));
        bg.setCornerRadius(dp(16));
        box.setBackground(bg);

        mainTv = new TextView(ctx);
        mainTv.setTextColor(Color.WHITE);
        mainTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, fontSp);
        mainTv.setGravity(Gravity.CENTER);
        mainTv.setShadowLayer(4f, 0f, 1f, Color.argb(160, 0, 0, 0));
        mainTv.setMaxLines(2);
        subTv = new TextView(ctx);
        subTv.setTextColor(Color.argb(215, 255, 255, 255));
        subTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, fontSp * 0.72f);
        subTv.setGravity(Gravity.CENTER);
        subTv.setShadowLayer(3f, 0f, 1f, Color.argb(140, 0, 0, 0));
        subTv.setMaxLines(2);
        box.addView(mainTv);
        box.addView(subTv);

        SharedPreferences sp = ctx.getSharedPreferences("floating_lyric", Context.MODE_PRIVATE);
        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            : WindowManager.LayoutParams.TYPE_PHONE;
        lp = new WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.WRAP_CONTENT, type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
        lp.horizontalMargin = 0.04f;
        lp.y = sp.getInt("y", dp(120));

        box.setOnTouchListener(new View.OnTouchListener() {
            float downY; int startY; long downAt; boolean moved;
            @Override public boolean onTouch(View v, MotionEvent e) {
                switch (e.getAction()) {
                    case MotionEvent.ACTION_DOWN:
                        downY = e.getRawY(); startY = lp.y; downAt = SystemClock.elapsedRealtime(); moved = false; return true;
                    case MotionEvent.ACTION_MOVE:
                        float dy = e.getRawY() - downY;
                        if (Math.abs(dy) > dp(6)) moved = true;
                        if (moved) { lp.y = Math.max(0, (int) (startY + dy)); try { wm.updateViewLayout(box, lp); } catch (Exception ignored) { } }
                        return true;
                    case MotionEvent.ACTION_UP:
                        if (moved) sp.edit().putInt("y", lp.y).apply();
                        else if (SystemClock.elapsedRealtime() - downAt > 600) { dismissed = true; removeBox(); }
                        return true;
                }
                return false;
            }
        });

        try { wm.addView(box, lp); } catch (Exception e) { box = null; return; }
        lastIdx = -2;
        render();
        main.removeCallbacks(tick);
        main.post(tick);
    }

    private void removeBox() {
        main.removeCallbacks(tick);
        if (box != null && wm != null) { try { wm.removeView(box); } catch (Exception ignored) { } }
        box = null;
    }
}
