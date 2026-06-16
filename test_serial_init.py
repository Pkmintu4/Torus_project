import serial
import time
import sys

def test_init():
    print("Testing COM5 Initialization with various sequences...")
    try:
        ser = serial.Serial('COM5', 115200, timeout=1)
        ser.dtr = True
        ser.rts = True
        time.sleep(0.1)
        
        # Sequences to try
        sequences = [
            b'',
            b'\n',
            b'\r\n',
            b'START\r\n',
            b'1',
            b'S',
            b'INIT\r\n'
        ]
        
        for seq in sequences:
            print(f"Sending: {seq}")
            if seq:
                ser.write(seq)
            
            for i in range(5):
                line = ser.readline()
                if line:
                    print(f"  Got: {line}")
                
        ser.close()
    except Exception as e:
        print(f"Error: {e}")

if __name__ == '__main__':
    test_init()
