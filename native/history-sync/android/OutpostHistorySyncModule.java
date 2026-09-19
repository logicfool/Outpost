package app.outpost.historysync;

import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import com.facebook.react.bridge.*;
import com.facebook.react.common.LifecycleState;
import java.lang.ref.WeakReference;

public final class OutpostHistorySyncModule extends ReactContextBaseJavaModule {

  static final Handler MAIN = new Handler(Looper.getMainLooper());
  static WeakReference<ReactApplicationContext> owner = new WeakReference<>(null);
  static String pendingId;
  static Promise pendingStart;
  static long pendingAt;

  public OutpostHistorySyncModule(ReactApplicationContext context) {
    super(context);
    owner = new WeakReference<>(context);
  }

  @Override
  public String getName() {
    return "OutpostHistorySync";
  }

  static boolean validId(String id) {
    return HistorySyncPolicy.validId(id);
  }

  static void event(String id, String reason) {
    ReactApplicationContext context = owner.get();
    if (context == null || !context.hasActiveReactInstance()) return;
    WritableMap data = Arguments.createMap();
    data.putString("runId", id);
    data.putString("reason", reason);
    context.emitDeviceEvent("OutpostHistorySyncStopped", data);
  }

  static void failStart(String id, String code) {
    if (!id.equals(pendingId)) return;
    Promise promise = pendingStart;
    pendingStart = null;
    pendingId = null;
    if (promise != null) promise.reject(
      code,
      "Background sync could not start. Keep Outpost open."
    );
  }

  @ReactMethod
  public void start(String id, Promise promise) {
    MAIN.post(() -> {
      ReactApplicationContext context = getReactApplicationContext();
      if (!validId(id)) {
        promise.reject("SYNC_ID", "Invalid sync operation.");
        return;
      }
      if (pendingStart != null || OutpostHistorySyncService.instance != null) {
        promise.reject("SYNC_BUSY", "A background sync is already active.");
        return;
      }
      if (
        context.getLifecycleState() != LifecycleState.RESUMED ||
        context.getCurrentActivity() == null
      ) {
        promise.reject("SYNC_NOT_VISIBLE", "Start sync while Outpost is visible.");
        return;
      }
      if (!OutpostHistorySyncService.notificationsAllowed(context)) {
        promise.reject("NOTIFICATIONS_DENIED", "Enable chat sync notifications first.");
        return;
      }
      pendingId = id;
      pendingStart = promise;
      pendingAt = SystemClock.elapsedRealtime();
      try {
        Intent intent = new Intent(context, OutpostHistorySyncService.class)
          .setAction(OutpostHistorySyncService.START)
          .putExtra("runId", id);
        if (android.os.Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent);
        else context.startService(intent);
        MAIN.postDelayed(() -> {
          if (!id.equals(pendingId)) return;
          OutpostHistorySyncService service = OutpostHistorySyncService.instance;
          if (service != null && id.equals(service.runId)) service.end("START_TIMEOUT", false);
          failStart(id, "SYNC_START_TIMEOUT");
        }, 10000);
      } catch (Exception error) {
        failStart(id, "SYNC_START_FAILED");
      }
    });
  }

  @ReactMethod
  public void runnerReady(String id) {
    MAIN.post(() -> {
      OutpostHistorySyncService service = OutpostHistorySyncService.instance;
      if (
        !validId(id) ||
        service == null ||
        !id.equals(service.runId) ||
        !id.equals(pendingId) ||
        service.ended
      ) return;
      service.ready = true;
      service.touch();
      Promise promise = pendingStart;
      pendingId = null;
      pendingStart = null;
      if (promise != null) promise.resolve(true);
    });
  }

  @ReactMethod
  public void pulse(
    String id,
    double checked,
    double total,
    double conversations,
    double failed,
    Promise promise
  ) {
    MAIN.post(() -> {
      OutpostHistorySyncService service = OutpostHistorySyncService.instance;
      if (!validId(id) || service == null || !id.equals(service.runId) || !service.ready) {
        promise.resolve(false);
        return;
      }
      if (!OutpostHistorySyncService.notificationsAllowed(getReactApplicationContext())) {
        service.end("NOTIFICATIONS_DISABLED", true);
        promise.resolve(false);
        return;
      }
      service.touch();
      service.update(count(checked), count(total), count(conversations), count(failed));
      promise.resolve(!service.ended);
    });
  }

  private static int count(double value) {
    return HistorySyncPolicy.count(value);
  }

  @ReactMethod
  public void finish(String id, String outcome, Promise promise) {
    MAIN.post(() -> {
      OutpostHistorySyncService service = OutpostHistorySyncService.instance;
      if (service != null && validId(id) && id.equals(service.runId)) service.end(
        "complete".equals(outcome)
          ? "COMPLETE"
          : "cancelled".equals(outcome)
            ? "CANCELLED"
            : "PAUSED",
        true
      );
      if (validId(id)) failStart(id, "SYNC_CANCELLED");
      final long deadline = SystemClock.elapsedRealtime() + 2000;
      MAIN.post(
        new Runnable() {
          @Override
          public void run() {
            if (
              service != null &&
              OutpostHistorySyncService.instance == service &&
              SystemClock.elapsedRealtime() < deadline
            ) {
              MAIN.postDelayed(this, 25);
              return;
            }
            promise.resolve(null);
          }
        }
      );
    });
  }

  @ReactMethod
  public void addListener(String name) {}

  @ReactMethod
  public void removeListeners(double count) {}

  @Override
  public void invalidate() {
    MAIN.post(() -> {
      if (owner.get() != getReactApplicationContext()) return;
      OutpostHistorySyncService service = OutpostHistorySyncService.instance;
      if (service != null) service.end("RUNTIME_STOPPED", false);
      owner.clear();
    });
    super.invalidate();
  }
}
