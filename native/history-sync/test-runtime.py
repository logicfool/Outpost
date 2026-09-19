from pathlib import Path
import argparse, subprocess

p = argparse.ArgumentParser()
p.add_argument("--tools", required=True)
p.add_argument("--work", required=True)
args = p.parse_args()
root = Path(__file__).resolve().parents[2]
work = Path(args.work)
work.mkdir(parents=True, exist_ok=True)
sources = {}


def source(name, text):
    sources[name] = text


source(
    "android/Manifest.java",
    'package android; public class Manifest { public static class permission {public static final String POST_NOTIFICATIONS="post";} }',
)
source(
    "android/R.java",
    "package android; public class R { public static class drawable {public static final int stat_notify_sync=1;} }",
)
source(
    "android/net/Uri.java",
    "package android.net; public class Uri {public String value;private Uri(String v){value=v;}public static Uri parse(String v){return new Uri(v);}}",
)
source(
    "android/os/Build.java",
    "package android.os; public class Build {public static class VERSION {public static int SDK_INT=36;}}",
)
source(
    "android/os/SystemClock.java",
    "package android.os; public class SystemClock {public static long now=100000;public static long elapsedRealtime(){return now;}}",
)
source(
    "android/os/Looper.java",
    "package android.os; public class Looper {public static Looper getMainLooper(){return new Looper();}}",
)
source(
    "android/content/pm/PackageManager.java",
    "package android.content.pm; public class PackageManager {public static final int PERMISSION_GRANTED=0;public android.content.Intent getLaunchIntentForPackage(String p){return new android.content.Intent();}}",
)
source(
    "android/content/pm/ServiceInfo.java",
    "package android.content.pm; public class ServiceInfo {public static final int FOREGROUND_SERVICE_TYPE_DATA_SYNC=1;}",
)
source(
    "android/content/Intent.java",
    """package android.content;
public class Intent {public static final int FLAG_ACTIVITY_SINGLE_TOP=1,FLAG_ACTIVITY_CLEAR_TOP=2;public String action;public android.net.Uri data;public final java.util.Map<String,String> extras=new java.util.HashMap<>();
 public Intent(){}public Intent(Context c,Class<?> cl){}public Intent setAction(String a){action=a;return this;}public String getAction(){return action;}public Intent putExtra(String k,String v){extras.put(k,v);return this;}public String getStringExtra(String k){return extras.get(k);}public Intent addFlags(int f){return this;}public Intent setData(android.net.Uri u){data=u;return this;}}
""",
)
source(
    "android/os/Handler.java",
    """package android.os;import java.util.*;
public class Handler {static class Item {Handler h;Runnable r;long at;Item(Handler h,Runnable r,long at){this.h=h;this.r=r;this.at=at;}}static java.util.List<Item> q=new ArrayList<>();public Handler(Looper l){}public void post(Runnable r){r.run();}public void postDelayed(Runnable r,long t){q.add(new Item(this,r,SystemClock.now+t));}public void removeCallbacksAndMessages(Object x){q.removeIf(i->i.h==this);}public static void reset(){q.clear();}public static void advance(long ms){SystemClock.now+=ms;for(int n=0;n<500;n++){Item due=q.stream().filter(i->i.at<=SystemClock.now).min(Comparator.comparingLong(i->i.at)).orElse(null);if(due==null)return;q.remove(due);due.r.run();}throw new AssertionError("timer runaway");}}
""",
)
source(
    "android/content/Context.java",
    """package android.content;
public class Context {public static android.app.NotificationManager manager=new android.app.NotificationManager();public static Intent started;public static int permission=0;public <T>T getSystemService(Class<T> c){return c.cast(manager);}public int checkSelfPermission(String p){return permission;}public void startForegroundService(Intent i){started=i;}public void startService(Intent i){started=i;}public android.content.pm.PackageManager getPackageManager(){return new android.content.pm.PackageManager();}public String getPackageName(){return "app.outpost.valorant";}}
""",
)
source(
    "android/app/NotificationChannel.java",
    """package android.app;public class NotificationChannel {public final String id;public int importance;public NotificationChannel(String id,String name,int importance){this.id=id;this.importance=importance;}public int getImportance(){return importance;}public void setDescription(String x){}public void setSound(Object a,Object b){}public void enableVibration(boolean b){}}
""",
)
source(
    "android/app/NotificationManager.java",
    """package android.app;import java.util.*;public class NotificationManager {public static final int IMPORTANCE_LOW=2,IMPORTANCE_NONE=0;public boolean enabled=true,failNotify=false;public Map<String,NotificationChannel> channels=new HashMap<>();public Map<Integer,Notification> shown=new HashMap<>();public int updates;public boolean areNotificationsEnabled(){return enabled;}public NotificationChannel getNotificationChannel(String n){return channels.get(n);}public void createNotificationChannel(NotificationChannel c){channels.putIfAbsent(c.id,c);}public void notify(int id,Notification n){if(failNotify)throw new IllegalStateException("blocked");updates++;shown.put(id,n);}}
""",
)
source(
    "android/app/PendingIntent.java",
    """package android.app;import android.content.*;public class PendingIntent {public static final int FLAG_UPDATE_CURRENT=1,FLAG_IMMUTABLE=2;public Intent intent;public int flags;public static PendingIntent getActivity(Context c,int id,Intent i,int f){return make(i,f);}public static PendingIntent getService(Context c,int id,Intent i,int f){return make(i,f);}static PendingIntent make(Intent i,int f){PendingIntent p=new PendingIntent();p.intent=i;p.flags=f;return p;}}
""",
)
source(
    "android/app/Notification.java",
    """package android.app;import android.content.*;import java.util.*;
public class Notification {public static final String CATEGORY_PROGRESS="progress";public static final int VISIBILITY_PRIVATE=0,FOREGROUND_SERVICE_IMMEDIATE=1;public String title,text;public boolean ongoing,onlyOnce,autoCancel;public int progress,max;public List<Action> actions=new ArrayList<>();
 public static class Action {public PendingIntent pending;public static class Builder {Action a=new Action();public Builder(Object icon,String title,PendingIntent p){a.pending=p;}public Action build(){return a;}}}
 public static class Builder {Notification n=new Notification();public Builder(Context c){}public Builder(Context c,String channel){}public Builder setSmallIcon(int i){return this;}public Builder setContentTitle(String s){n.title=s;return this;}public Builder setContentText(String s){n.text=s;return this;}public Builder setOnlyAlertOnce(boolean v){n.onlyOnce=v;return this;}public Builder setOngoing(boolean v){n.ongoing=v;return this;}public Builder setAutoCancel(boolean v){n.autoCancel=v;return this;}public Builder setCategory(String s){return this;}public Builder setVisibility(int i){return this;}public Builder setShowWhen(boolean b){return this;}public Builder setContentIntent(PendingIntent p){return this;}public Builder setProgress(int max,int at,boolean indeterminate){n.max=max;n.progress=at;return this;}public Builder addAction(Action a){n.actions.add(a);return this;}public Builder setForegroundServiceBehavior(int i){return this;}public Notification build(){return n;}}}
""",
)
source(
    "android/app/Service.java",
    """package android.app;import android.content.*;public class Service extends Context {public static final int START_NOT_STICKY=2,STOP_FOREGROUND_REMOVE=1;public boolean foreground=false,stopped=false;public int serviceType;public int onStartCommand(Intent i,int f,int id){return 0;}public void startForeground(int id,Notification n){foreground=true;manager.notify(id,n);}public void startForeground(int id,Notification n,int type){serviceType=type;startForeground(id,n);}public void stopForeground(int flags){foreground=false;manager.shown.clear();}public void stopSelf(){stopped=true;}public void onTimeout(int id,int type){}public void onTaskRemoved(Intent i){}public void onDestroy(){}}
""",
)
source(
    "com/facebook/react/bridge/WritableMap.java",
    "package com.facebook.react.bridge;public class WritableMap extends java.util.HashMap<String,Object>{public void putString(String k,String v){put(k,v);}}",
)
source(
    "com/facebook/react/bridge/Arguments.java",
    "package com.facebook.react.bridge;public class Arguments {public static WritableMap createMap(){return new WritableMap();}}",
)
source(
    "com/facebook/react/common/LifecycleState.java",
    "package com.facebook.react.common;public enum LifecycleState {RESUMED,BEFORE_RESUME,BEFORE_CREATE}",
)
source(
    "com/facebook/react/bridge/Promise.java",
    "package com.facebook.react.bridge;public interface Promise {void resolve(Object v);void reject(String code,String message);}",
)
source(
    "com/facebook/react/bridge/ReactMethod.java",
    "package com.facebook.react.bridge;public @interface ReactMethod {}",
)
source(
    "com/facebook/react/bridge/NativeModule.java",
    "package com.facebook.react.bridge;public interface NativeModule {}",
)
source(
    "com/facebook/react/bridge/ReactApplicationContext.java",
    """package com.facebook.react.bridge;public class ReactApplicationContext extends android.content.Context {public com.facebook.react.common.LifecycleState lifecycle=com.facebook.react.common.LifecycleState.RESUMED;public final java.util.List<WritableMap> events=new java.util.ArrayList<>();public boolean hasActiveReactInstance(){return true;}public void emitDeviceEvent(String n,WritableMap d){events.add(d);}public com.facebook.react.common.LifecycleState getLifecycleState(){return lifecycle;}public Object getCurrentActivity(){return lifecycle==com.facebook.react.common.LifecycleState.RESUMED?this:null;}}
""",
)
source(
    "com/facebook/react/bridge/ReactContextBaseJavaModule.java",
    "package com.facebook.react.bridge;public abstract class ReactContextBaseJavaModule implements NativeModule {private ReactApplicationContext c;public ReactContextBaseJavaModule(ReactApplicationContext c){this.c=c;}public abstract String getName();public ReactApplicationContext getReactApplicationContext(){return c;}public void invalidate(){}}",
)
source(
    "com/facebook/react/uimanager/ViewManager.java",
    "package com.facebook.react.uimanager;public class ViewManager {}",
)
source(
    "com/facebook/react/ReactPackage.java",
    "package com.facebook.react;public interface ReactPackage {java.util.List<com.facebook.react.bridge.NativeModule> createNativeModules(com.facebook.react.bridge.ReactApplicationContext c);java.util.List<com.facebook.react.uimanager.ViewManager> createViewManagers(com.facebook.react.bridge.ReactApplicationContext c);}",
)
source(
    "com/facebook/react/jstasks/HeadlessJsTaskConfig.java",
    """package com.facebook.react.jstasks;import com.facebook.react.bridge.*;public class HeadlessJsTaskConfig {public String name;public WritableMap data;public long timeout;public boolean allowed;public HeadlessJsTaskConfig(String n,WritableMap d,long t,boolean a){name=n;data=d;timeout=t;allowed=a;}}
""",
)
source(
    "com/facebook/react/HeadlessJsTaskService.java",
    """package com.facebook.react;import com.facebook.react.jstasks.*;public class HeadlessJsTaskService extends android.app.Service {public int taskCount=0,destroyCount=0;public HeadlessJsTaskConfig config;protected void startTask(HeadlessJsTaskConfig c){if(!foreground)throw new AssertionError("Task started without foreground notification");config=c;taskCount++;}public void onHeadlessJsTaskFinish(int id){if(id==1)stopSelf();}public void onDestroy(){destroyCount++;super.onDestroy();}}
""",
)
test = root / "native/history-sync/HistorySyncRuntimeTest.java"
source("app/outpost/historysync/HistorySyncRuntimeTest.java", test.read_text())
files = []
for name, text in sources.items():
    f = work / "src" / name
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(text)
    files.append(f)
classes = work / "classes"
classes.mkdir(exist_ok=True)
java = Path(args.tools) / "root/usr/lib/jvm/java-21-openjdk-arm64/bin/java"
production = sorted((root / "native/history-sync/android").glob("*.java"))
subprocess.run(
    [
        str(java.with_name("javac")),
        "-J-XX:UseSVE=0",
        "--release",
        "17",
        "-d",
        str(classes),
        *map(str, files),
        *map(str, production),
    ],
    check=True,
)
subprocess.run(
    [
        str(java),
        "-XX:UseSVE=0",
        "-cp",
        str(classes),
        "app.outpost.historysync.HistorySyncRuntimeTest",
    ],
    check=True,
)
