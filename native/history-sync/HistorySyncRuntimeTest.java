package app.outpost.historysync;

import android.app.*;
import android.content.*;
import android.os.*;
import com.facebook.react.bridge.*;
import com.facebook.react.common.LifecycleState;

public final class HistorySyncRuntimeTest {

  static final String ID = "a".repeat(64),
    OTHER = "b".repeat(64);
  static int checks = 0;

  static void check(boolean value) {
    checks++;
    if (!value) throw new AssertionError("Native runtime assertion " + checks);
  }

  static class Result implements Promise {

    Object value;
    String error;
    boolean resolved;

    public void resolve(Object v) {
      value = v;
      resolved = true;
    }

    public void reject(String code, String message) {
      error = code;
    }
  }

  static ReactApplicationContext context;
  static OutpostHistorySyncModule module;

  static void reset() {
    if (OutpostHistorySyncService.instance != null) OutpostHistorySyncService.instance.onDestroy();
    Handler.reset();
    SystemClock.now = 100000;
    Context.manager = new NotificationManager();
    Context.started = null;
    Context.permission = 0;
    OutpostHistorySyncService.instance = null;
    OutpostHistorySyncModule.pendingId = null;
    OutpostHistorySyncModule.pendingStart = null;
    context = new ReactApplicationContext();
    module = new OutpostHistorySyncModule(context);
  }

  static OutpostHistorySyncService start(Result result) {
    module.start(ID, result);
    check(Context.started != null);
    OutpostHistorySyncService service = new OutpostHistorySyncService();
    check(service.onStartCommand(Context.started, 0, 1) == Service.START_NOT_STICKY);
    return service;
  }

  static OutpostHistorySyncService ready() {
    Result r = new Result();
    OutpostHistorySyncService s = start(r);
    check(!r.resolved);
    module.runnerReady(ID);
    check(r.resolved && Boolean.TRUE.equals(r.value));
    return s;
  }

  public static void main(String[] args) {
    reset();
    Result r = new Result();
    module.start("../invalid", r);
    check("SYNC_ID".equals(r.error));
    check(Context.started == null);
    reset();
    context.lifecycle = LifecycleState.BEFORE_RESUME;
    r = new Result();
    module.start(ID, r);
    check("SYNC_NOT_VISIBLE".equals(r.error));
    check(Context.started == null);
    reset();
    Context.permission = -1;
    r = new Result();
    module.start(ID, r);
    check("NOTIFICATIONS_DENIED".equals(r.error));
    check(Context.started == null);
    reset();
    OutpostHistorySyncService s = ready();
    check(s.foreground);
    check(s.serviceType == 1);
    check(s.taskCount == 1);
    check(s.config.allowed);
    check(s.config.timeout == HistorySyncPolicy.MAX_RUN_MS + 15000);
    check(s.config.name.equals("OutpostChatHistorySync"));
    Result duplicate = new Result();
    module.start(OTHER, duplicate);
    check("SYNC_BUSY".equals(duplicate.error));
    Notification n = Context.manager.shown.get(OutpostHistorySyncService.NOTIFICATION_ID);
    check(n.ongoing && n.onlyOnce);
    check(n.actions.size() == 1);
    check(n.actions.get(0).pending.intent.data.value.equals("outpost-sync://stop/" + ID));
    check(
      n.actions.get(0).pending.flags ==
        (PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT)
    );
    s.onHeadlessJsTaskFinish(99);
    check(!s.ended && !s.stopped);
    Result foreign = new Result();
    module.pulse(OTHER, 99, 100, 99, 0, foreign);
    check(Boolean.FALSE.equals(foreign.value));
    check(s.checked == 0);
    Result pulse = new Result();
    module.pulse(ID, 12, 100, 4, 1, pulse);
    check(Boolean.TRUE.equals(pulse.value));
    check(s.checked == 12);
    n = Context.manager.shown.get(OutpostHistorySyncService.NOTIFICATION_ID);
    check(n.text.contains("12 / 100"));
    check(n.text.contains("4 conversations"));
    check(n.text.contains("1 failed"));
    int updates = Context.manager.updates;
    module.pulse(ID, 13, 100, 4, 1, new Result());
    check(Context.manager.updates == updates);
    s.onStartCommand(
      new Intent().setAction(OutpostHistorySyncService.STOP).putExtra("runId", OTHER),
      0,
      2
    );
    check(!s.ended);
    s.onStartCommand(n.actions.get(0).pending.intent, 0, 3);
    check(s.ended && !s.foreground && s.stopped);
    check(
      context.events
        .get(context.events.size() - 1)
        .get("reason")
        .equals("CANCELLED")
    );
    module.pulse(ID, 14, 100, 4, 1, (pulse = new Result()));
    check(Boolean.FALSE.equals(pulse.value));
    n = Context.manager.shown.get(OutpostHistorySyncService.NOTIFICATION_ID);
    check(!n.ongoing && n.actions.isEmpty());
    check(n.title.endsWith("stopped"));
    s.onDestroy();
    check(OutpostHistorySyncService.instance == null);
    check(s.destroyCount == 1);
    reset();
    s = ready();
    module.pulse(ID, 15, 15, 5, 0, new Result());
    Result finish = new Result();
    module.finish(ID, "complete", finish);
    check(s.ended);
    check(
      Context.manager.shown
        .get(OutpostHistorySyncService.NOTIFICATION_ID)
        .title.equals("Chat history synced")
    );
    s.onDestroy();
    Handler.advance(30);
    check(finish.resolved);
    reset();
    s = ready();
    Handler.advance(90000);
    check(s.ended);
    check(
      context.events
        .get(context.events.size() - 1)
        .get("reason")
        .equals("WORKER_STALLED")
    );
    reset();
    s = ready();
    SystemClock.now += HistorySyncPolicy.MAX_RUN_MS;
    s.touch();
    Handler.advance(1);
    check(s.ended);
    check(
      context.events
        .get(context.events.size() - 1)
        .get("reason")
        .equals("TIME_LIMIT")
    );
    reset();
    s = ready();
    s.onTimeout(1, 1);
    check(s.ended && s.stopped);
    check(
      context.events
        .get(context.events.size() - 1)
        .get("reason")
        .equals("OS_TIMEOUT")
    );
    reset();
    s = ready();
    Context.manager.enabled = false;
    module.pulse(ID, 1, 10, 1, 0, (pulse = new Result()));
    check(Boolean.FALSE.equals(pulse.value));
    check(s.ended);
    reset();
    s = ready();
    Context.manager.failNotify = true;
    SystemClock.now += 5000;
    module.pulse(ID, 1, 10, 1, 0, (pulse = new Result()));
    check(Boolean.FALSE.equals(pulse.value));
    check(s.ended);
    reset();
    r = new Result();
    s = start(r);
    Handler.advance(10000);
    check(s.ended);
    check(r.error != null);
    module.runnerReady(ID);
    check(!s.ready);
    reset();
    s = new OutpostHistorySyncService();
    s.onStartCommand(
      new Intent().setAction(OutpostHistorySyncService.STOP).putExtra("runId", OTHER),
      0,
      1
    );
    s.onDestroy();
    check(s.taskCount == 0 && s.destroyCount == 0);
    reset();
    s = new OutpostHistorySyncService();
    s.onStartCommand(
      new Intent().setAction(OutpostHistorySyncService.START).putExtra("runId", ID),
      0,
      1
    );
    check(s.taskCount == 0 && s.stopped);
    reset();
    s = ready();
    s.onTaskRemoved(new Intent());
    check(s.ended && s.stopped);
    check(Context.manager.shown.isEmpty());
    reset();
    s = ready();
    module.invalidate();
    check(s.ended);
    check(OutpostHistorySyncModule.owner.get() == null);
    reset();
    java.util.List<com.facebook.react.ReactPackage> packages = new java.util.ArrayList<>();
    OutpostHistorySyncPackage.install(packages);
    OutpostHistorySyncPackage.install(packages);
    check(packages.size() == 1);
    check(
      packages.get(0).createNativeModules(context).get(0).getClass() ==
        OutpostHistorySyncModule.class
    );
    reset();
    System.out.println("Native runtime assertions passed: " + checks);
  }
}
