---
title: 一次简单的内核驱动项目实现 Life-Signal-Drive
date: '2025-12-18 13:51:00'
updated: '2025-12-18 13:53:03'
permalink: posts/15.html
categories:
  - 知识分享
tags:
  - Linux Kernel
---

# Life-Signal-Drive

项目链接：[生命信号驱动 - QEMU-Friendly Linux内核驱动项目](http://aarch64.hehezhou.cn/linux3/01.html)

本次介绍的是关于我学习的第一个内核驱动项目，虽然比较简单，但是可以帮助我很好的理解关于内核初始化，定时器，`proc` 文件系统和内核/用户空间的数据交互 。

我使用的是 `wsl2 + ubuntu22.04` 子系统，内核版本是 `6.6.87.2-microsoft-standard-WSL2` ，一般我们在标准的 `Linux` 发行版中是直接使用 `apt`  安装内核头文件的，但是在 `WSL2` 中，我们无法直接使用这种方式来进行安装， 这种情况我们可以前往 `WSL2-Linux-Kernel` 项目页面，下载与内核版本对应的内核源码， 解压到 `wsl2` 内，进入源代码目录，使用 `make headers_install` 进行头文件安装，由于我们需要编译一个内核模块，我们还需要执行 `make modules_prepare` 。

本次项目用到了 `timer_list` 、`proc_dir_entry` 、`proc_ops` 三个关键数据结构：

##  timer_list

```
struct timer_list {
	/*
	 * All fields that change during normal runtime grouped to the
	 * same cacheline
	 */
	struct hlist_node	entry;
	unsigned long		expires;
	void			(*function)(struct timer_list *);
	u32			flags;

#ifdef CONFIG_LOCKDEP
	struct lockdep_map	lockdep_map;
#endif
};
```

这是 `Linux` 内核用于管理内核定时器（Kernel Timer）的核心结构体 `struct timer_list` ，它的设计目标是提供一种在未来某个特定时间点执行某个函数的机制 。

下面介绍一下该结构体的关键成员：

`struct hlist_node entry;`

这个是一个哈希链表节点，使用 `hlist` （双向链表，但头节点仅需一个指针），这个是为了节省内存空间。

`unsigned long expires`

设定定时器的到期时间点，它的单位是 `jiffies` （内核自启动以来的节拍数），当系统的 `jiffies` 值大于或等于 `expires` 时，定时器被视为到期 。

`void (*function)(struct timer_list *)`

回调函数指针，这是定时器的核心逻辑，当定时器到期的时候，内核会在中断上下文中调用这个函数，它接收 `struct timer_list *` 作为参数，以便在回调函数内部通过 `container_of` 获取包含该定时器的宿主结构体。

初始化：`timer_setup()` 设置回调函数 。

激活：`mod_timer(timer, jiffies + delay)` 设置过期时间并启动 。

停止：使用 `del_timer()` 或 `del_timer_sync()` 来注销定时器 。

## proc_dir_entry

```
struct proc_dir_entry {
	/*
	 * number of callers into module in progress;
	 * negative -> it's going away RSN
	 */
	atomic_t in_use;
	refcount_t refcnt;
	struct list_head pde_openers;	/* who did ->open, but not ->release */
	/* protects ->pde_openers and all struct pde_opener instances */
	spinlock_t pde_unload_lock;
	struct completion *pde_unload_completion;
	const struct inode_operations *proc_iops;
	union {
		const struct proc_ops *proc_ops;
		const struct file_operations *proc_dir_ops;
	};
	const struct dentry_operations *proc_dops;
	union {
		const struct seq_operations *seq_ops;
		int (*single_show)(struct seq_file *, void *);
	};
	proc_write_t write;
	void *data;
	unsigned int state_size;
	unsigned int low_ino;
	nlink_t nlink;
	kuid_t uid;
	kgid_t gid;
	loff_t size;
	struct proc_dir_entry *parent;
	struct rb_root subdir;
	struct rb_node subdir_node;
	char *name;
	umode_t mode;
	u8 flags;
	u8 namelen;
	char inline_name[];
} __randomize_layout;
```

`proc_dir_entry` 是 `/proc` 文件的入口，作用是创建 `/proc/counter` 文件 。

```
static struct proc_dir_entry *proc_entry;

proc_entry = proc_create(PROC_NAME, 0444, NULL, &proc_fops);
if (!proc_entry) {
    printk(KERN_ERR "Failed to create /proc/%s\n", PROC_NAME);
    return -ENOMEM;
}
```

### proc_create()

```
 struct proc_dir_entry *proc_create(const char *name, umode_t mode, struct proc_dir_entry *parent, const struct proc_ops *proc_ops);
 
 proc_create(const char *name, umode_t mode, struct proc_dir_entry *parent,
	    const struct proc_ops *proc_ops)
{ return NULL; }
```

可以通过 `proc_create` 来设置 `proc_dir_entry` 结构体内部的四个主要成员 ，`mode = 0444` 代表全局只读，`parent = NULL` 代表将文件存储在 `/proc` 根路径下，`proc_ops` 这里担任的是一个比较重要的作用，随着新版本内核的出现（大概在 `v5.6` 前后），我们为了减少不必要的开销，不再使用 `file_operations` ，而是改用了 `proc_ops` ，因为 `file_operations` 有很多成员，而 `proc_ops` 只需要使用其中一部分 。

## proc_ops

```
struct proc_ops {
	unsigned int proc_flags;
	int	(*proc_open)(struct inode *, struct file *);
	ssize_t	(*proc_read)(struct file *, char __user *, size_t, loff_t *);
	ssize_t (*proc_read_iter)(struct kiocb *, struct iov_iter *);
	ssize_t	(*proc_write)(struct file *, const char __user *, size_t, loff_t *);
	/* mandatory unless nonseekable_open() or equivalent is used */
	loff_t	(*proc_lseek)(struct file *, loff_t, int);
	int	(*proc_release)(struct inode *, struct file *);
	__poll_t (*proc_poll)(struct file *, struct poll_table_struct *);
	long	(*proc_ioctl)(struct file *, unsigned int, unsigned long);
#ifdef CONFIG_COMPAT
	long	(*proc_compat_ioctl)(struct file *, unsigned int, unsigned long);
#endif
	int	(*proc_mmap)(struct file *, struct vm_area_struct *);
	unsigned long (*proc_get_unmapped_area)(struct file *, unsigned long, unsigned long, unsigned long, unsigned long);
} __randomize_layout;
```

`proc_ops`  是专门为 `/proc` 文件系统设计的操作接口结构体 ，包括了一些基本读写操作比如 `proc_open`、`proc_read` 或者 `proc_write` ，还有一些高级功能如 `proc_ioctl` 提供一个后门，用于执行不适合用读写表达的自定义控制命令 。

我们可以通过这个结构体来实现 `/proc` 文件内核与用户空间的数据交互，但是我们还需要使用 `copy_to_user` 这个关键函数 。

## 前置准备

```
#include <linux/kernel.h>
#include <linux/module.h>
#include <linux/proc_fs.h>
#include <linux/uaccess.h>
#include <linux/jiffies.h>
#include <linux/timer.h>

#define PROC_NAME "counter"

static unsigned long seconds, minutes, hours, days;
static struct timer_list my_timer;
static struct proc_dir_entry *proc_entry;
```

这里包含了一些需要的头文件，然后定义了我们需要创建的 `/proc` 文件的名字，以及定义了一些变量还有结构体。

## 定时器设定

```
static void timer_callback(struct timer_list *t)
{
    seconds++;
    if(seconds==60){
        minutes++;
        seconds=0;
        if(minutes==60){
            hours++;
            minutes=0;
            if(hours==24){
                days++;
                hours=0;
            }
        }
    }
    mod_timer(&my_timer, jiffies + HZ);
}
```

在定时器设定上运用了一个简单的时间算法，用于统计时间数据 ，然后我们设置了每次调用回调函数的时间间隔，时间周期为 `1s` ，也就是说每隔一秒就会更新时间数据，符合当前项目的主题——生命周期驱动 。

```
static ssize_t proc_read(struct file *file, char __user *buf, size_t count, loff_t *ppos)
{
    char str[72];
    int len;
    
    if(*ppos > 0) return 0;

    len = snprintf(str,sizeof(str),"Life Cycle : %lu days %lu hours %lu minutes %lu seconds...\n", days, hours, minutes, seconds);
    
    if(copy_to_user(buf, str, len)) return -EFAULT;
    
    *ppos = len;
    return len;
}

static const struct proc_ops proc_fops = {
    .proc_read = proc_read,
};
```

设置 `proc_ops` 内的成员 `proc_read` ，让我们对这个 `/proc` 文件有一个读操作，可以把内核空间的数据通过 `copy_to_user` 发送到用户空间，这里发送的是时间数据 。

## 模块初始化

```
static int __init heartbeat_init(void){
    timer_setup(&my_timer, timer_callback, 0);
    mod_timer(&my_timer, jiffies + HZ);

    proc_entry = proc_create(PROC_NAME, 0444, NULL, &proc_fops);
    if(!proc_entry){
        printk(KERN_ERR"Failed to create /proc/%s\n", PROC_NAME);
        return -ENOMEM;
    }

    printk(KERN_INFO"Heartbeat driver loaded!\n");
    return 0;
}

static void __exit heartbeat_exit(void){
    del_timer(&my_timer);
    remove_proc_entry(PROC_NAME, NULL);
    printk(KERN_INFO"Heartbeat driver unloaded!\n");
}

module_init(heartbeat_init);
module_exit(heartbeat_exit);

MODULE_LICENSE("GPL");
MODULE_AUTHOR("SPACEDRAG0N");
MODULE_DESCRIPTION("A simple heartbeat driver");
```

初始化模块，注册定时器，绑定回调函数，启动计时器，创建 `/proc` 文件，同时设置许可证，署名，增添描述 

## Makefile

```
obj-m += heartbeat.o

KDIR := /root/WSL2-Linux-Kernel

PWD := $(shell pwd)

all: 
	make -C $(KDIR) M=$(PWD) modules

clean:
	make -C $(KDIR) M=$(PWD) clean
```

需要注意的是驱动名必须要与驱动源代码名一致，这里我写了两个命令一个用来编译驱动，一个用来清理驱动，`KDIR` 需要是我们之前编译内核驱动的目录路径 。

编译完之后如果没有任何问题我们就可以使用 `insmod` 来导入模块

```
insmod heartbeat.ko
```

我们也可以利用 `rmmod` 来卸载模块

```
rmmod heartbeat.ko
```

如果成功导入，那么我们就可以通过 `cat /proc/counter` 来查看我们的时间数据了

![image-20251218134953479](/images/posts/202512181352185.png)