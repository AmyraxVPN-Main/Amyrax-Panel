function createWorkQueue() {
  const os = require('os');
  const { performance, monitorEventLoopDelay } = require('perf_hooks');
  const MiB = 1024 * 1024;
  const integer = (value, fallback, min, max) => /^\d+$/.test(String(value)) && Number(value) >= min && Number(value) <= max ? Number(value) : fallback;
  const fault = (code, message) => Object.assign(new Error(message), { code, status:503 });
  class WorkQueue {
    constructor(options = {}) {
      const env = options.env || process.env;
      const cores = os.availableParallelism ? os.availableParallelism() : os.cpus().length;
      const constrained = typeof process.constrainedMemory === 'function' ? process.constrainedMemory() : 0;
      const memory = Math.min(os.totalmem(), constrained > 0 ? constrained : Infinity);
      const automatic = Math.max(1, Math.min(4, cores, Math.floor(memory / (512 * MiB))));
      this.maximum = integer(env.AMYRAX_WORK_CONCURRENCY, automatic, 1, 8);
      this.maxQueued = integer(env.AMYRAX_WORK_QUEUE_SIZE, 64, 1, 256);
      this.waitMs = integer(env.AMYRAX_WORK_WAIT_MS, 15000, 1000, 60000);
      this.baseInterval = integer(env.AMYRAX_WORK_INTERVAL_MS, 50, 10, 1000);
      this.limit = this.maximum; this.interval = this.baseInterval; this.pressure = 'normal';
      this.active = 0; this.pending = []; this.nextStart = 0; this.healthy = 0; this.closed = false;
      this.counts = { completed:0, rejected:0, timedOut:0, cancelled:0, failed:0 };
      this.lag = monitorEventLoopDelay({resolution:20}); this.lag.enable();
      this.elu = performance.eventLoopUtilization();
      this.sample = options.sample || (() => {
        const current = performance.eventLoopUtilization(), utilization = performance.eventLoopUtilization(current,this.elu).utilization;
        this.elu = current;
        const delay = this.lag.percentile(95) / 1e6; this.lag.reset();
        const available = typeof process.availableMemory === 'function' ? process.availableMemory() : os.freemem();
        const headroom = constrained > 0 ? constrained - process.memoryUsage().rss : Infinity;
        return {utilization, delay, freeMemory:Math.min(available,os.freemem(),headroom)};
      });
      this.monitor = setInterval(() => this.adjust(),1000); this.monitor.unref();
    }
    adjust() {
      const {utilization,delay,freeMemory} = this.sample();
      if (freeMemory < 32 * MiB) {
        this.pressure = 'paused'; this.limit = 0; this.healthy = 0;
      } else if (freeMemory < 128 * MiB || utilization > 0.8 || delay > 80) {
        this.pressure = 'busy'; this.limit = 1; this.interval = Math.max(250,this.baseInterval); this.healthy = 0;
      } else if (++this.healthy >= 3) {
        this.limit = Math.min(this.maximum,this.limit+1);
        this.pressure = this.limit === this.maximum ? 'normal' : 'busy';
        this.interval = this.pressure === 'normal' ? this.baseInterval : Math.max(250,this.baseInterval);
        this.healthy = 0;
      }
      this.kick();
    }
    snapshot() {
      return { active:this.active, pending:this.pending.length, capacity:this.limit, maximum:this.maximum,
        maxQueued:this.maxQueued, waitMs:this.waitMs, intervalMs:this.interval, pressure:this.pressure, ...this.counts };
    }
    run(job, signal) {
      if (this.closed) return Promise.reject(fault('WORK_CLOSED','سرویس در حال توقف است؛ کمی بعد دوباره تلاش کنید.'));
      if (signal?.aborted) return Promise.reject(fault('WORK_CANCELLED','درخواست لغو شد.'));
      if (this.pending.length >= this.maxQueued) {
        this.counts.rejected++;
        return Promise.reject(fault('WORK_FULL','صف پردازش پُر است؛ چند ثانیه بعد دوباره تلاش کنید.'));
      }
      return new Promise((resolve,reject) => {
        const item = { job,resolve,reject,signal,deadline:performance.now()+this.waitMs };
        const remove = (code,message,counter) => {
          const index = this.pending.indexOf(item); if (index < 0) return;
          this.pending.splice(index,1); this.cleanup(item); this.counts[counter]++;
          reject(fault(code,message)); this.kick();
        };
        item.abort = () => remove('WORK_CANCELLED','درخواست لغو شد.','cancelled');
        item.timer = setTimeout(() => remove('WORK_TIMEOUT','مهلت انتظار در صف تمام شد؛ درخواست اجرا نشد. دوباره تلاش کنید.','timedOut'),this.waitMs);
        signal?.addEventListener('abort',item.abort,{once:true});
        this.pending.push(item); this.kick();
      });
    }
    cleanup(item) { clearTimeout(item.timer); item.signal?.removeEventListener('abort',item.abort); }
    kick() {
      if (this.closed || this.wake || !this.pending.length || this.active >= this.limit) return;
      this.wake = setTimeout(() => { this.wake = null; this.drain(); },Math.max(0,this.nextStart-performance.now()));
    }
    drain() {
      if (this.closed || this.active >= this.limit) return;
      const item = this.pending.shift(); if (!item) return;
      this.cleanup(item);
      if (item.signal?.aborted || performance.now() >= item.deadline) {
        const cancelled = item.signal?.aborted;
        this.counts[cancelled ? 'cancelled' : 'timedOut']++;
        item.reject(fault(cancelled ? 'WORK_CANCELLED' : 'WORK_TIMEOUT','درخواست در صف اجرا نشد؛ دوباره تلاش کنید.'));
        this.kick(); return;
      }
      this.active++; this.nextStart = performance.now()+this.interval;
      Promise.resolve().then(item.job).then(value => {this.counts.completed++; item.resolve(value);},error => {this.counts.failed++; item.reject(error);})
        .finally(() => {this.active--; this.kick();});
      this.kick();
    }
    wrap(handler) {
      return (req,res,next) => {
        const controller = new AbortController();
        const abort = () => controller.abort();
        req.once('aborted',abort); res.once('close',abort);
        if (req.aborted || res.destroyed) controller.abort();
        return this.run(() => handler(req,res,controller.signal),controller.signal).catch(error => {
          if (controller.signal.aborted || res.destroyed || res.writableEnded) return;
          if (error.code?.startsWith('WORK_')) {
            res.setHeader('Retry-After','5'); res.setHeader('Cache-Control','no-store');
            return res.status(503).json({ok:false,error:error.message,code:error.code,retryAfter:5});
          }
          return next(error);
        }).finally(() => {req.removeListener('aborted',abort); res.removeListener('close',abort);});
      };
    }
    close() {
      this.closed = true; clearInterval(this.monitor); this.lag.disable(); clearTimeout(this.wake); this.wake = null;
      for (const item of this.pending.splice(0)) {this.cleanup(item); item.reject(fault('WORK_CLOSED','سرویس در حال توقف است؛ کمی بعد دوباره تلاش کنید.'));}
    }
  }
  return WorkQueue;
}
module.exports = createWorkQueue;
