import math
rot_deg = 30
rot = rot_deg * math.pi / 180

hw = 100
hh = 50

sx = hw * math.cos(rot) - hh * math.sin(rot)
sy = hw * math.sin(rot) + hh * math.cos(rot)
print("Screen corner:", sx, sy)

dx = sx
dy = sy
angle = -rot_deg * math.pi / 180

rx = dx * math.cos(angle) - dy * math.sin(angle)
ry = dx * math.sin(angle) + dy * math.cos(angle)
print("Unrotated rx, ry:", rx, ry)
